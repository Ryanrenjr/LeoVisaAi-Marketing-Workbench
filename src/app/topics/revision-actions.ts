"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import {
  getContentAssetById,
  getContentAssets,
  getResearchPackById,
  getResearchSources,
  getTopicById,
} from "@/lib/topics";
import { canManageContentAssets } from "@/lib/permissions";
import { nextVersionNumber } from "@/lib/content-versions";
import { buildWechatBrandFooter, deriveTitleAndContent, CONTENT_TYPE_REVISION } from "@/lib/content-mapping";
import { getBrandConfig } from "@/lib/brand-config";
import { runContentRevisionTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import type { ModelRef, TaskType } from "@/lib/ai/providers/types";

/**
 * Takes the latest compliance findings for one content_asset and asks
 * Employee H to produce a revised draft addressing exactly those findings
 * — saved as a new content_assets version, same versioning every other
 * generation/regeneration already uses. Never auto-approves anything;
 * the new version still needs Leo's (and optionally compliance's) look.
 */
export async function reviseContentAsset(
  contentAssetId: string,
  override?: ModelRef | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const asset = await getContentAssetById(contentAssetId);
  if (!asset) return { ok: false, error: "未找到该内容草稿。" };

  const revisionTaskType = CONTENT_TYPE_REVISION[asset.content_type];
  if (!revisionTaskType) {
    return { ok: false, error: "这个版本暂不支持 AI 自动修改，请手动编辑。" };
  }

  const supabase = await createClient();
  const { data: latestReview, error: reviewError } = await supabase
    .from("compliance_reviews")
    .select("findings")
    .eq("content_asset_id", contentAssetId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reviewError) return { ok: false, error: "读取合规审核结果失败。" };
  if (!latestReview || latestReview.findings.length === 0) {
    return { ok: false, error: "还没有合规审核标出的问题，无需修改。" };
  }

  const [topic, researchPack] = await Promise.all([
    getTopicById(asset.topic_id),
    getResearchPackById(asset.research_pack_id),
  ]);
  if (!topic || !researchPack) return { ok: false, error: "未找到对应的选题或研究成果。" };
  const sources = await getResearchSources(researchPack.id);

  const result = await runContentRevisionTask(
    revisionTaskType,
    {
      topic,
      researchPack,
      sources,
      existingContentText: asset.content,
      findings: latestReview.findings,
    },
    override,
  );

  if (isRouterResolutionFailure(result)) {
    await supabase.from("topic_activity_log").insert({
      topic_id: asset.topic_id,
      activity_type: "content_revision_failed",
      actor_id: user.id,
      detail: { platform: asset.platform, error: result.error },
    });
    revalidatePath(`/topics/${asset.topic_id}`);
    revalidatePath("/team/reviser");
    return { ok: false, error: result.error };
  }

  const model = getModel(result.provider, result.modelId);
  const { usageLogFailed } = await writeUsageLog(supabase, {
    workflow_type: "content_revision",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: asset.topic_id,
    platform: asset.platform,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: revisionTaskType satisfies TaskType,
    digital_employee: TASK_TYPE_EMPLOYEE[revisionTaskType],
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    await supabase.from("topic_activity_log").insert({
      topic_id: asset.topic_id,
      activity_type: "content_revision_failed",
      actor_id: user.id,
      detail: { platform: asset.platform, error: result.error, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
    });
    revalidatePath(`/topics/${asset.topic_id}`);
    revalidatePath("/team/reviser");
    return { ok: false, error: result.error ?? "修改失败。" };
  }

  // Same deterministic append as content-actions.ts's initial generation —
  // the revision model regenerates the whole WechatArticle shape (title,
  // full_article, closing_note, ...) from scratch, so it needs the brand
  // footer re-injected here too, never carried over implicitly.
  let structuredContent: Record<string, unknown> = result.data;
  if (asset.platform === "WECHAT_OFFICIAL_ACCOUNT" && "closing_note" in result.data) {
    const brand = await getBrandConfig();
    structuredContent = { ...result.data, brand_footer: buildWechatBrandFooter(brand) };
  }

  const existingAssets = await getContentAssets(asset.topic_id);
  const version = nextVersionNumber(existingAssets, asset.platform, asset.content_type);
  const { title, content } = deriveTitleAndContent(asset.platform, structuredContent);

  const { error: insertError } = await supabase.from("content_assets").insert({
    topic_id: asset.topic_id,
    research_pack_id: asset.research_pack_id,
    platform: asset.platform,
    content_type: asset.content_type,
    title,
    content,
    structured_content: structuredContent,
    version,
    created_by: user.id,
  });
  if (insertError) return { ok: false, error: "修改已生成，但保存失败，请重试。" };

  await supabase.from("topic_activity_log").insert({
    topic_id: asset.topic_id,
    activity_type: "content_revised",
    actor_id: user.id,
    detail: { platform: asset.platform, version, ...(usageLogFailed ? { usageLogFailed: true } : {}) },
  });

  revalidatePath(`/topics/${asset.topic_id}`);
  revalidatePath("/team/reviser");
  revalidatePath("/team/compliance");
  return { ok: true };
}
