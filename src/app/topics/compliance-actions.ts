"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { getContentAssetById, getResearchPackById } from "@/lib/topics";
import { canRunCompliance } from "@/lib/permissions";
import { runComplianceTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import { CONTENT_PLATFORM_LABEL } from "@/lib/status";
import type { ContentPlatform } from "@/lib/types";
import type { ModelRef } from "@/lib/ai/providers/types";

/**
 * Employee D re-checks one content_asset against the research pack it was
 * generated from. Advisory only — writes a row to compliance_reviews for
 * Leo to read; never changes topics.status or content_assets.status on
 * its own. See docs/security-boundaries.md "AI usage".
 */
export async function runComplianceReview(contentAssetId: string, override?: ModelRef | null): Promise<void> {
  const user = await requireUser();
  if (!canRunCompliance(user.role)) throw new Error("Forbidden: ADMIN role required");

  const asset = await getContentAssetById(contentAssetId);
  if (!asset) return;

  const researchPack = await getResearchPackById(asset.research_pack_id);
  if (!researchPack) return;

  const platformLabel = CONTENT_PLATFORM_LABEL[asset.platform as ContentPlatform] ?? asset.platform;

  const result = await runComplianceTask(
    { platform: platformLabel, textForReview: asset.content },
    researchPack,
    override,
  );

  const supabase = await createClient();

  if (isRouterResolutionFailure(result)) {
    console.error("[compliance] router resolution failed:", result.error);
    return;
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
    return;
  }

  await supabase.from("compliance_reviews").insert({
    topic_id: asset.topic_id,
    content_asset_id: asset.id,
    overall_risk: result.data.overall_risk,
    findings: result.data.findings,
    model_alias: `${result.provider}/${result.modelId}`,
    provider: result.provider,
    created_by: user.id,
  });

  revalidatePath(`/topics/${asset.topic_id}`);
  revalidatePath("/team/compliance");
}
