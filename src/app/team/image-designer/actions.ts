"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { canManageContentAssets } from "@/lib/permissions";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { buildImagePrompt } from "@/lib/ai/image-generation";
import { runImageGenerationTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import type { ModelRef } from "@/lib/ai/providers/types";

/**
 * Generates one cover image for a topic's already-reviewed 小红书 post
 * draft. ADMIN-only, same gate as every other content-generation action
 * (canManageContentAssets) — this produces a real, billable OpenAI image.
 */
export async function generateCoverImage(
  topicId: string,
  override?: ModelRef | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) return { ok: false, error: "未找到选题。" };

  const assets = await getContentAssets(topicId);
  const post = getLatestForLineage(assets, "XIAOHONGSHU", "xiaohongshu_post");
  if (!post) return { ok: false, error: "请先生成小红书文字草稿，再生成配图。" };

  const prompt = buildImagePrompt(topic, { title: post.title, content: post.content });
  const result = await runImageGenerationTask(prompt, override);

  const supabase = await createClient();

  if (isRouterResolutionFailure(result)) {
    return { ok: false, error: result.error };
  }

  const model = getModel(result.provider, result.modelId);
  await writeUsageLog(supabase, {
    workflow_type: "image_generation",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topicId,
    platform: "XIAOHONGSHU",
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "IMAGE_GENERATION",
    digital_employee: TASK_TYPE_EMPLOYEE.IMAGE_GENERATION,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error ?? "生成失败。" };
  }

  const [imageBase64] = result.data.images;
  const bytes = Buffer.from(imageBase64, "base64");
  const path = `${topicId}/${Date.now()}-${crypto.randomUUID()}.png`;

  const { error: uploadError } = await supabase.storage
    .from("content-images")
    .upload(path, bytes, { contentType: "image/png" });
  if (uploadError) return { ok: false, error: "图片已生成，但保存失败，请重试。" };

  const { error: insertError } = await supabase.from("content_images").insert({
    topic_id: topicId,
    content_asset_id: post.id,
    prompt,
    image_path: path,
    model_alias: `${result.provider}/${result.modelId}`,
    provider: result.provider,
    created_by: user.id,
  });
  if (insertError) return { ok: false, error: "图片已生成，但记录保存失败，请重试。" };

  revalidatePath("/team/image-designer");
  return { ok: true };
}
