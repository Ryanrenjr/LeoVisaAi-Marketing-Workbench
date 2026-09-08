"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getContentAssets, getLatestResearchPack, getResearchSources, getTopicById } from "@/lib/topics";
import { canGenerateContent, canManageContentAssets } from "@/lib/permissions";
import { getLatestForLineage, nextVersionNumber } from "@/lib/content-versions";
import { buildWechatBrandFooter, deriveTitleAndContent, mergeEditIntoStructuredContent } from "@/lib/content-mapping";
import { getBrandConfig } from "@/lib/brand-config";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import { runContentTask, runWechatFullArticleTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import { claimGenerationRunTask, completeGenerationRunTask, failGenerationRunTask } from "@/lib/generation-run-tasks";
import type { GenericContentTaskType } from "@/lib/ai/content-schemas";
import type { ModelRef, TaskType } from "@/lib/ai/providers/types";
import type {
  ContentPlatform,
  ContentType,
  CurrentUser,
  ResearchPack,
  ResearchSource,
  Topic,
} from "@/lib/types";

export interface ContentEditState {
  error: string | null;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const PLATFORM_CONTENT_TYPE: Record<
  ContentPlatform,
  Extract<ContentType, "video_script" | "xiaohongshu_post" | "wechat_article">
> = {
  VIDEO_CHANNEL: "video_script",
  XIAOHONGSHU: "xiaohongshu_post",
  WECHAT_OFFICIAL_ACCOUNT: "wechat_article",
};

const PLATFORM_TASK_TYPE: Record<ContentPlatform, GenericContentTaskType> = {
  VIDEO_CHANNEL: "VIDEO_WRITING",
  XIAOHONGSHU: "XIAOHONGSHU_WRITING",
  WECHAT_OFFICIAL_ACCOUNT: "WECHAT_ARTICLE_WRITING",
};

const ALL_PLATFORMS: ContentPlatform[] = ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"];

/**
 * Generates one platform's content via the Model Router, saves it as a new
 * version, and logs both the AI usage and the activity — regardless of
 * success or failure. Shared by the initial 3-platform batch and
 * single-platform regeneration so a failure in one never touches the
 * others (see docs/phase-4-plan.md "Failure handling"). `override` is the
 * section-9 one-off model choice for this single execution.
 */
async function generateAndPersistPlatform(
  supabase: SupabaseServerClient,
  topic: Topic,
  researchPack: ResearchPack,
  sources: ResearchSource[],
  platform: ContentPlatform,
  user: CurrentUser,
  override?: ModelRef | null,
  runId?: string,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  const contentType = PLATFORM_CONTENT_TYPE[platform];
  const taskType = PLATFORM_TASK_TYPE[platform];
  const evidenceInput = { topic, researchPack, sources };
  const taskKey = `content:${platform}`;

  // Atomic claim (live audit finding, round 6): the `since` prefilter in
  // generateContent already narrows to platforms that look like they
  // still need generating, but two concurrent requests can both pass
  // that check before either writes — this closes that window. Only
  // engaged when called from the orchestrated pipeline (runId provided);
  // a manual single-platform regenerate from a team page has no run to
  // claim against and behaves exactly as before.
  if (runId) {
    const claim = await claimGenerationRunTask(runId, taskKey);
    if (claim.outcome === "already_completed") return { ok: true };
    if (claim.outcome === "timed_out") return { ok: false, error: claim.error };
  }

  const result = await runContentTask(taskType, evidenceInput, override);

  if (isRouterResolutionFailure(result)) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topic.id,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: { platform, error: result.error },
    });
    if (runId) await failGenerationRunTask(runId, taskKey, result.error);
    return { ok: false, error: result.error };
  }

  const model = getModel(result.provider, result.modelId);
  const { usageLogFailed } = await writeUsageLog(supabase, {
    workflow_type: "content",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topic.id,
    platform,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: taskType satisfies TaskType,
    digital_employee: TASK_TYPE_EMPLOYEE[taskType],
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topic.id,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: { platform, error: result.error, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
    });
    if (runId) await failGenerationRunTask(runId, taskKey, result.error ?? "生成失败");
    return { ok: false, error: result.error ?? "生成失败" };
  }

  // The task-specific system prompt tells the model NOT to write the
  // brand footer itself ("appended separately") — this is that separate
  // step, deterministic and never AI-guessed. See buildWechatBrandFooter.
  let structuredContent: Record<string, unknown> = result.data;
  if (platform === "WECHAT_OFFICIAL_ACCOUNT" && "closing_note" in result.data) {
    const brand = await getBrandConfig();
    structuredContent = { ...result.data, brand_footer: buildWechatBrandFooter(brand) };
  }

  const existing = await getContentAssets(topic.id);
  const version = nextVersionNumber(existing, platform, contentType);
  const { title, content } = deriveTitleAndContent(platform, structuredContent);

  const { error: insertError } = await supabase.from("content_assets").insert({
    topic_id: topic.id,
    research_pack_id: researchPack.id,
    platform,
    content_type: contentType,
    title,
    content,
    structured_content: structuredContent,
    version,
    created_by: user.id,
  });
  if (insertError) {
    if (runId) await failGenerationRunTask(runId, taskKey, "保存失败");
    return { ok: false, error: "保存失败" };
  }

  await supabase.from("topic_activity_log").insert({
    topic_id: topic.id,
    activity_type: version === 1 ? "content_generated" : "content_regenerated",
    actor_id: user.id,
    detail: { platform, version, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
  });

  if (runId) await completeGenerationRunTask(runId, taskKey);

  return { ok: true, version };
}

/** RESEARCH_APPROVED → CONTENT_DRAFT, once — only when the topic is still exactly at RESEARCH_APPROVED and at least one asset now exists. Idempotent: safe to call after every generation attempt. */
async function maybeAdvanceToContentDraft(
  supabase: SupabaseServerClient,
  topicId: string,
  user: CurrentUser,
) {
  const topic = await getTopicById(topicId);
  if (!topic || topic.status !== "RESEARCH_APPROVED") return;

  const assets = await getContentAssets(topicId);
  if (assets.length === 0) return;

  await supabase
    .from("topics")
    .update({ status: "CONTENT_DRAFT" })
    .eq("id", topicId)
    .eq("status", "RESEARCH_APPROVED");

  await supabase.from("topic_status_events").insert({
    topic_id: topicId,
    from_status: "RESEARCH_APPROVED",
    to_status: "CONTENT_DRAFT",
    approved_by: user.id,
  });
}

async function loadGenerationContext(topicId: string) {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) throw new Error("未找到选题。");

  // The mandatory gate — enforced here, not just by hiding the button.
  // "One Research → Three Outputs" only starts once research is approved.
  if (!canGenerateContent(topic.status)) {
    throw new Error("无法生成内容：研究尚未批准（需要状态为 RESEARCH_APPROVED 或之后）。");
  }

  const researchPack = await getLatestResearchPack(topicId);
  if (!researchPack) throw new Error("未找到已批准的研究成果，无法生成内容。");

  const sources = await getResearchSources(researchPack.id);
  return { user, topic, researchPack, sources };
}

/**
 * "生成内容" — the initial "One Research → Three Outputs" batch, or a
 * subset of it when the operator picked specific platforms at the "通过"
 * step (live user instruction: "一键出选题的时候，可以有一个选择... 出小
 * 红书图文/出视频号口播/出公众号文字/一键全出" — see PlatformChoiceRadios
 * and approveAndGoHome in pipeline-actions.ts). Each platform routes
 * independently, so a per-platform override doesn't make sense here — see
 * regeneratePlatformContent for single-platform override.
 *
 * `since` (a generation_runs.created_at timestamp) makes a retry
 * idempotent at the platform level — live audit finding: without this, a
 * failed content step (say 小红书 failed while 视频号/公众号 succeeded)
 * would re-generate ALL THREE platforms on retry, re-billing the two that
 * already worked. When provided, any platform that already has a
 * content_assets version created at or after `since` is skipped entirely
 * — the source of truth is the content itself, not a separate ledger that
 * could drift from what actually happened.
 */
export async function generateContent(
  topicId: string,
  platforms: ContentPlatform[] = ALL_PLATFORMS,
  since?: string,
  runId?: string,
) {
  const { user, topic, researchPack, sources } = await loadGenerationContext(topicId);
  const supabase = await createClient();

  let platformsToGenerate = platforms;
  if (since) {
    const existingAssets = await getContentAssets(topicId);
    platformsToGenerate = platforms.filter((platform) => {
      const latest = getLatestForLineage(existingAssets, platform, PLATFORM_CONTENT_TYPE[platform]);
      return !latest || latest.created_at < since;
    });
    if (platformsToGenerate.length === 0) return; // every requested platform already has a fresh-enough version from this run
  }

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "content_generation_started",
    actor_id: user.id,
    detail: { platforms: platformsToGenerate },
  });

  const settled = await Promise.allSettled(
    platformsToGenerate.map((platform) =>
      generateAndPersistPlatform(supabase, topic, researchPack, sources, platform, user, undefined, runId),
    ),
  );

  await maybeAdvanceToContentDraft(supabase, topicId, user);

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
  revalidatePath("/research-completed");

  // A discarded {ok:false} here used to mean "小红书失败，视频号/公众号
  // 成功，前端仍然100%完成" — every platform's failure now stops the
  // pipeline (see pipeline-actions.ts's runContentGenerationStep, which
  // just calls this and lets the throw propagate) instead of silently
  // producing an incomplete set of drafts that looks like a full success.
  const failures = settled
    .map((result, i) => ({ platform: platformsToGenerate[i], result }))
    .filter(({ result }) => result.status === "rejected" || !result.value.ok);
  if (failures.length > 0) {
    const detail = failures
      .map(
        ({ platform, result }) =>
          `${CONTENT_PLATFORM_LABEL[platform]}：${result.status === "rejected" ? String(result.reason) : (result.value.error ?? "生成失败")}`,
      )
      .join("；");
    throw new Error(`内容生成失败：${detail}`);
  }
}

const PLATFORM_TEAM_PAGE: Record<ContentPlatform, string> = {
  VIDEO_CHANNEL: "/team/video-editor",
  XIAOHONGSHU: "/team/xiaohongshu-editor",
  WECHAT_OFFICIAL_ACCOUNT: "/team/wechat-editor",
};

/** Retry/regenerate a single platform — used both for retrying a failed platform and deliberate regeneration, and now also called directly from that platform's own team page (see e.g. team/video-editor/page.tsx) so generation is genuinely one click from there, not just from the Topic Detail page. `override` is the section-9 one-off model choice for this single execution; it never changes the persisted default. */
export async function regeneratePlatformContent(
  topicId: string,
  platform: ContentPlatform,
  override?: ModelRef | null,
) {
  const { user, topic, researchPack, sources } = await loadGenerationContext(topicId);
  const supabase = await createClient();

  await generateAndPersistPlatform(supabase, topic, researchPack, sources, platform, user, override);
  await maybeAdvanceToContentDraft(supabase, topicId, user);

  revalidatePath(`/topics/${topicId}`);
  revalidatePath(PLATFORM_TEAM_PAGE[platform]);
}

/** The separate, deliberate "生成完整文章" action — never runs automatically. */
export async function generateFullArticle(topicId: string, override?: ModelRef | null) {
  const { user, topic, researchPack, sources } = await loadGenerationContext(topicId);

  const existingAssets = await getContentAssets(topicId);
  const outlineAsset = getLatestForLineage(existingAssets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_outline");
  if (!outlineAsset) throw new Error("请先生成公众号大纲，再生成完整文章。");

  const outline = outlineAsset.structured_content as unknown as {
    title_options: string[];
    summary: string;
    detailed_outline: string[];
    key_claims: string[];
  };

  const supabase = await createClient();
  const result = await runWechatFullArticleTask({ topic, researchPack, sources, outline }, override);

  if (isRouterResolutionFailure(result)) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: { platform: "WECHAT_OFFICIAL_ACCOUNT", contentType: "wechat_full_article", error: result.error },
    });
    revalidatePath(`/topics/${topicId}`);
    return;
  }

  const model = getModel(result.provider, result.modelId);
  const { usageLogFailed } = await writeUsageLog(supabase, {
    workflow_type: "content",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topicId,
    platform: "WECHAT_OFFICIAL_ACCOUNT",
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "WECHAT_FULL_ARTICLE" satisfies TaskType,
    digital_employee: TASK_TYPE_EMPLOYEE.WECHAT_FULL_ARTICLE,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: {
        platform: "WECHAT_OFFICIAL_ACCOUNT",
        contentType: "wechat_full_article",
        error: result.error,
        ...(usageLogFailed ? { usageLogFailed: true } : {}),
      },
    });
    revalidatePath(`/topics/${topicId}`);
    return;
  }

  const version = nextVersionNumber(existingAssets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_full_article");
  await supabase.from("content_assets").insert({
    topic_id: topicId,
    research_pack_id: researchPack.id,
    platform: "WECHAT_OFFICIAL_ACCOUNT",
    content_type: "wechat_full_article",
    title: result.data.title,
    content: result.data.full_article,
    structured_content: result.data,
    version,
    created_by: user.id,
  });

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "full_article_generated",
    actor_id: user.id,
    detail: { version, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
  });

  revalidatePath(`/topics/${topicId}`);
}

/**
 * ADMIN edits a draft — this always creates a NEW version rather than
 * mutating the existing row, so AI-generated history is never silently
 * destroyed. Only the plain title/body are editable here (not the full
 * structured shape) — deliberately simple, see docs/phase-4-plan.md
 * "Editing".
 */
export async function editContentAsset(
  assetId: string,
  topicId: string,
  _prevState: ContentEditState,
  formData: FormData,
): Promise<ContentEditState> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) return { error: "仅 ADMIN 可编辑内容草稿。" };

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!title || !content) return { error: "标题和正文不能为空。" };

  const supabase = await createClient();
  const { data: current, error: fetchError } = await supabase
    .from("content_assets")
    .select("*")
    .eq("id", assetId)
    .single();
  if (fetchError || !current) return { error: "未找到该内容草稿。" };

  const structured = mergeEditIntoStructuredContent(
    current.platform,
    current.structured_content ?? {},
    title,
    content,
  );

  const existing = await getContentAssets(topicId);
  const version = nextVersionNumber(existing, current.platform, current.content_type);

  const { error: insertError } = await supabase.from("content_assets").insert({
    topic_id: topicId,
    research_pack_id: current.research_pack_id,
    platform: current.platform,
    content_type: current.content_type,
    title,
    content,
    structured_content: structured,
    version,
    created_by: user.id,
  });
  if (insertError) return { error: "保存失败，请重试。" };

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "content_edited",
    actor_id: user.id,
    detail: { platform: current.platform, content_type: current.content_type, version },
  });

  revalidatePath(`/topics/${topicId}`);
  redirect(`/topics/${topicId}`);
}
