"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { canGenerateContent, canManageContentAssets } from "@/lib/permissions";
import {
  getContentAssets,
  getLatestResearchPack,
  getResearchSources,
  getTopicById,
} from "@/lib/topics";
import { nextVersionNumber } from "@/lib/content-versions";
import { deriveTitleAndContent } from "@/lib/content-mapping";
import { runContentTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import { claimGenerationRunTask, completeGenerationRunTask, failGenerationRunTask } from "@/lib/generation-run-tasks";
import type { ModelRef } from "@/lib/ai/providers/types";

/**
 * Employee K（小红书图文规划员）— writes ONLY the P1–Pn text plan for a 小红书
 * 图文 carousel (what each page says, what its design direction should be).
 * Live user instruction (correction): K does not generate the images
 * itself — that button lives on E｜图片设计员's own page, reading K's plan
 * (see generateXiaohongshuCarousel in team/image-designer/actions.ts).
 * Deliberately separate from Employee D（小红书标题文案员）, which only
 * writes title/caption — see docs/digital-employee-skills.md "K｜小红书图文规划员".
 */

/**
 * "生成图文规划" — writes the P1–Pn page plan (xiaohongshu_pages), independent
 * of D's title/caption draft.
 *
 * `since` (a generation_runs.created_at timestamp — same convention as
 * generateContent/generateVideoCover/etc.) makes a retry idempotent: if
 * this run already produced an xiaohongshu_pages version (e.g. this
 * succeeded but markGenerationRunStep then failed, and the whole content
 * step got retried), skip calling the AI again rather than re-billing it.
 * The existence check itself is fail-closed (live audit
 * finding, round 5) — a DB error while checking is NOT the same as
 * "nothing exists yet", and must stop here rather than fall through to
 * another paid call.
 */
export async function generatePagesPlan(
  topicId: string,
  override?: ModelRef | null,
  since?: string,
  runId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) return { ok: false, error: "未找到选题。" };
  if (!canGenerateContent(topic.status)) {
    return { ok: false, error: "无法生成内容：研究尚未批准（需要状态为 RESEARCH_APPROVED 或之后）。" };
  }

  const supabase = await createClient();

  if (since) {
    const { data: existing, error: existingError } = await supabase
      .from("content_assets")
      .select("id")
      .eq("topic_id", topicId)
      .eq("platform", "XIAOHONGSHU")
      .eq("content_type", "xiaohongshu_pages")
      .gte("created_at", since)
      .limit(1)
      .maybeSingle();
    if (existingError) return { ok: false, error: `检查图文规划是否已生成失败，请重试：${existingError.message}` };
    if (existing) return { ok: true };
  }

  // Atomic claim (live audit finding, round 6) — the since check above
  // can't prevent two concurrent requests from both passing it before
  // either writes; this closes that window. Only engaged from the
  // orchestrated pipeline (runId provided) — a manual click from K's own
  // page has no run to claim against and behaves exactly as before.
  const taskKey = "content:XIAOHONGSHU:pages";
  if (runId) {
    const claim = await claimGenerationRunTask(runId, taskKey);
    if (claim.outcome === "already_completed") return { ok: true };
    if (claim.outcome === "timed_out") return { ok: false, error: claim.error };
  }

  const researchPack = await getLatestResearchPack(topicId);
  if (!researchPack) return { ok: false, error: "未找到已批准的研究成果，无法生成内容。" };
  const sources = await getResearchSources(researchPack.id);

  const result = await runContentTask("XIAOHONGSHU_PAGES_PLANNING", { topic, researchPack, sources }, override);

  if (isRouterResolutionFailure(result)) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: { platform: "XIAOHONGSHU", contentType: "xiaohongshu_pages", error: result.error },
    });
    if (runId) await failGenerationRunTask(runId, taskKey, result.error);
    return { ok: false, error: result.error };
  }

  const model = getModel(result.provider, result.modelId);
  const { usageLogFailed } = await writeUsageLog(supabase, {
    workflow_type: "content",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topicId,
    platform: "XIAOHONGSHU",
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "XIAOHONGSHU_PAGES_PLANNING",
    digital_employee: TASK_TYPE_EMPLOYEE.XIAOHONGSHU_PAGES_PLANNING,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    await supabase.from("topic_activity_log").insert({
      topic_id: topicId,
      activity_type: "content_generation_failed",
      actor_id: user.id,
      detail: {
        platform: "XIAOHONGSHU",
        contentType: "xiaohongshu_pages",
        error: result.error,
        ...(usageLogFailed ? { usageLogFailed: true } : {}),
      },
    });
    if (runId) await failGenerationRunTask(runId, taskKey, result.error ?? "生成失败");
    return { ok: false, error: result.error ?? "生成失败" };
  }

  const existing = await getContentAssets(topicId);
  const version = nextVersionNumber(existing, "XIAOHONGSHU", "xiaohongshu_pages");
  const { title, content } = deriveTitleAndContent("XIAOHONGSHU", result.data);

  const { error: insertError } = await supabase.from("content_assets").insert({
    topic_id: topicId,
    research_pack_id: researchPack.id,
    platform: "XIAOHONGSHU",
    content_type: "xiaohongshu_pages",
    title,
    content,
    structured_content: result.data,
    version,
    created_by: user.id,
  });
  if (insertError) {
    if (runId) await failGenerationRunTask(runId, taskKey, "保存失败");
    return { ok: false, error: "保存失败" };
  }

  await supabase.from("topic_activity_log").insert({
    topic_id: topicId,
    activity_type: version === 1 ? "content_generated" : "content_regenerated",
    actor_id: user.id,
    detail: { platform: "XIAOHONGSHU", contentType: "xiaohongshu_pages", version, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
  });

  if (runId) await completeGenerationRunTask(runId, taskKey);

  revalidatePath(`/topics/${topicId}`);
  revalidatePath("/team/xiaohongshu-image-planner");
  return { ok: true };
}
