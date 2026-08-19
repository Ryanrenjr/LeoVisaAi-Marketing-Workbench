"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getContentAssets, getLatestResearchPack, getResearchSources, getTopicById } from "@/lib/topics";
import { canGenerateContent, canManageContentAssets } from "@/lib/permissions";
import { getLatestForLineage, nextVersionNumber } from "@/lib/content-versions";
import { deriveTitleAndContent, mergeEditIntoStructuredContent } from "@/lib/content-mapping";
import {
  generateVideoChannelContent,
  generateXiaohongshuContent,
  generateWechatOutline,
  generateWechatFullArticle,
} from "@/lib/ai/content-agent";
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
  Extract<ContentType, "video_script" | "xiaohongshu_post" | "wechat_outline">
> = {
  VIDEO_CHANNEL: "video_script",
  XIAOHONGSHU: "xiaohongshu_post",
  WECHAT_OFFICIAL_ACCOUNT: "wechat_outline",
};

/**
 * Generates one platform's content, saves it as a new version, and logs
 * both the AI usage and the activity — regardless of success or failure.
 * Shared by the initial 3-platform batch and single-platform regeneration
 * so a failure in one never touches the others (see docs/phase-4-plan.md
 * "Failure handling").
 */
async function generateAndPersistPlatform(
  supabase: SupabaseServerClient,
  topic: Topic,
  researchPack: ResearchPack,
  sources: ResearchSource[],
  platform: ContentPlatform,
  user: CurrentUser,
): Promise<{ ok: boolean; version?: number; error?: string }> {
  const contentType = PLATFORM_CONTENT_TYPE[platform];
  const evidenceInput = { topic, researchPack, sources };

  const result =
    platform === "VIDEO_CHANNEL"
      ? await generateVideoChannelContent(evidenceInput)
      : platform === "XIAOHONGSHU"
        ? await generateXiaohongshuContent(evidenceInput)
        : await generateWechatOutline(evidenceInput);

  await supabase.from("ai_usage_log").insert({
    workflow_type: "content",
    model_alias: result.modelAlias,
    topic_id: topic.id,
    platform,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
  });

  if (!result.ok) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topic.id,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: { platform, error: result.error },
    });
    return { ok: false, error: result.error };
  }

  const existing = await getContentAssets(topic.id);
  const version = nextVersionNumber(existing, platform, contentType);
  const { title, content } = deriveTitleAndContent(platform, result.content);

  const { error: insertError } = await supabase.from("content_assets").insert({
    topic_id: topic.id,
    research_pack_id: researchPack.id,
    platform,
    content_type: contentType,
    title,
    content,
    structured_content: result.content,
    version,
    created_by: user.id,
  });
  if (insertError) return { ok: false, error: "保存失败" };

  await supabase.from("topic_activity_log").insert({
    topic_id: topic.id,
    activity_type: version === 1 ? "content_generated" : "content_regenerated",
    actor_id: user.id,
    detail: { platform, version },
  });

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

/** "生成内容" — the initial "One Research → Three Outputs" batch. */
export async function generateContent(topicId: string) {
  const { user, topic, researchPack, sources } = await loadGenerationContext(topicId);
  const supabase = await createClient();

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "content_generation_started",
    actor_id: user.id,
    detail: { platforms: ["VIDEO_CHANNEL", "XIAOHONGSHU", "WECHAT_OFFICIAL_ACCOUNT"] },
  });

  await Promise.allSettled([
    generateAndPersistPlatform(supabase, topic, researchPack, sources, "VIDEO_CHANNEL", user),
    generateAndPersistPlatform(supabase, topic, researchPack, sources, "XIAOHONGSHU", user),
    generateAndPersistPlatform(supabase, topic, researchPack, sources, "WECHAT_OFFICIAL_ACCOUNT", user),
  ]);

  await maybeAdvanceToContentDraft(supabase, topicId, user);

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/topics");
  revalidatePath("/research-completed");
}

/** Retry/regenerate a single platform — used both for retrying a failed platform and deliberate regeneration. */
export async function regeneratePlatformContent(topicId: string, platform: ContentPlatform) {
  const { user, topic, researchPack, sources } = await loadGenerationContext(topicId);
  const supabase = await createClient();

  await generateAndPersistPlatform(supabase, topic, researchPack, sources, platform, user);
  await maybeAdvanceToContentDraft(supabase, topicId, user);

  revalidatePath(`/topics/${topicId}`);
}

/** The separate, deliberate "生成完整文章" action — never runs automatically. */
export async function generateFullArticle(topicId: string) {
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
  const result = await generateWechatFullArticle({ topic, researchPack, sources, outline });

  await supabase.from("ai_usage_log").insert({
    workflow_type: "content",
    model_alias: result.modelAlias,
    topic_id: topicId,
    platform: "WECHAT_OFFICIAL_ACCOUNT",
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
  });

  if (!result.ok) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: { platform: "WECHAT_OFFICIAL_ACCOUNT", contentType: "wechat_full_article", error: result.error },
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
    title: result.content.title,
    content: result.content.full_article,
    structured_content: result.content,
    version,
    created_by: user.id,
  });

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: "full_article_generated",
    actor_id: user.id,
    detail: { version },
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
