"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getContentAssetById, getResearchPackById } from "@/lib/topics";
import { buildPublishFacingTextForCompliance } from "@/lib/content-mapping";
import { canRunCompliance } from "@/lib/permissions";
import { runComplianceTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import { claimGenerationRunTask, completeGenerationRunTask, failGenerationRunTask } from "@/lib/generation-run-tasks";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import type { ContentPlatform } from "@/lib/types";
import type { ModelRef } from "@/lib/ai/providers/types";

/**
 * Employee D re-checks one content_asset against the research pack it was
 * generated from. Advisory only — writes a row to compliance_reviews for
 * Leo to read; never changes topics.status or content_assets.status on
 * its own. See docs/security-boundaries.md "AI usage".
 *
 * Returns `{ok:false}` on every failure path instead of silently
 * `console.error`-ing and returning nothing — a caller (see
 * runComplianceStep in pipeline-actions.ts) that only checks "does a
 * compliance_reviews row exist" cannot otherwise tell "review ran and
 * found nothing" apart from "review never ran at all", which is exactly
 * the fail-open bug this fixes: a failed review must stop the pipeline,
 * never be treated as an implicit LOW-risk pass.
 */
export async function runComplianceReview(
  contentAssetId: string,
  override?: ModelRef | null,
  runId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canRunCompliance(user.role)) throw new Error("Forbidden: ADMIN role required");

  const asset = await getContentAssetById(contentAssetId);
  if (!asset) return { ok: false, error: "未找到对应的内容草稿。" };

  const researchPack = await getResearchPackById(asset.research_pack_id);
  if (!researchPack) return { ok: false, error: "未找到对应的研究成果。" };

  // Atomic claim (live audit finding, round 6) — runComplianceStep's
  // existing prefilter (skip assets that already have a compliance_reviews
  // row) can't prevent two concurrent requests from both passing it before
  // either writes; this closes that window. Only engaged from the
  // orchestrated pipeline (runId provided) — a manual re-review from
  // /team/compliance has no run to claim against and behaves as before.
  const taskKey = `compliance:${contentAssetId}`;
  if (runId) {
    const claim = await claimGenerationRunTask(runId, taskKey);
    if (claim.outcome === "already_completed") return { ok: true };
    if (claim.outcome === "timed_out") return { ok: false, error: claim.error };
  }

  const platformLabel = CONTENT_PLATFORM_LABEL[asset.platform as ContentPlatform] ?? asset.platform;

  const result = await runComplianceTask(
    { platform: platformLabel, textForReview: buildPublishFacingTextForCompliance(asset) },
    researchPack,
    override,
  );

  const supabase = await createClient();

  if (isRouterResolutionFailure(result)) {
    console.error("[compliance] router resolution failed:", result.error);
    if (runId) await failGenerationRunTask(runId, taskKey, result.error);
    return { ok: false, error: result.error };
  }

  const model = getModel(result.provider, result.modelId);
  await writeUsageLog(supabase, {
    workflow_type: "compliance",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: asset.topic_id,
    platform: asset.platform,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "COMPLIANCE",
    digital_employee: TASK_TYPE_EMPLOYEE.COMPLIANCE,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    console.error("[compliance] task failed:", result.error);
    if (runId) await failGenerationRunTask(runId, taskKey, result.error ?? "合规审核失败。");
    return { ok: false, error: result.error ?? "合规审核失败。" };
  }

  const { error: insertError } = await supabase.from("compliance_reviews").insert({
    topic_id: asset.topic_id,
    content_asset_id: asset.id,
    overall_risk: result.data.overall_risk,
    findings: result.data.findings,
    model_alias: `${result.provider}/${result.modelId}`,
    provider: result.provider,
    created_by: user.id,
  });
  if (insertError) {
    if (runId) await failGenerationRunTask(runId, taskKey, "合规结果保存失败。");
    return { ok: false, error: "合规结果保存失败。" };
  }

  if (runId) await completeGenerationRunTask(runId, taskKey);

  revalidatePath(`/topics/${asset.topic_id}`);
  revalidatePath("/team/compliance");
  return { ok: true };
}
