"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { runPerformanceAnalysisTask, isRouterResolutionFailure } from "@/lib/ai/router";
import { getModel } from "@/lib/ai/providers/registry";
import { TASK_TYPE_EMPLOYEE } from "@/lib/ai/providers/types";
import { writeUsageLog } from "@/lib/ai/usage-log";
import type { ContentPlatform } from "@/lib/types";

export interface UploadPerformanceState {
  error: string | null;
}

const ALLOWED_MIME: Record<string, "image/png" | "image/jpeg" | "image/webp"> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/webp": "image/webp",
};

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Employee E: Leo uploads one screenshot of a post's own performance
 * dashboard. This is the ONE narrow, explicit exception to "no upload
 * feature anywhere in this app" (docs/security-boundaries.md) — only a
 * platform's own public post-performance numbers, stored in a private
 * bucket only staff can read, never a client document.
 */
export async function uploadPerformanceScreenshot(
  _prevState: UploadPerformanceState,
  formData: FormData,
): Promise<UploadPerformanceState> {
  const user = await requireUser();

  const topicId = String(formData.get("topicId") ?? "");
  const platform = String(formData.get("platform") ?? "") as ContentPlatform;
  const file = formData.get("screenshot");

  if (!topicId) return { error: "请选择对应的选题。" };
  if (!platform) return { error: "请选择平台。" };
  if (!(file instanceof File) || file.size === 0) return { error: "请选择一张截图。" };

  const mimeType = ALLOWED_MIME[file.type];
  if (!mimeType) return { error: "只支持 PNG / JPEG / WEBP 格式的截图。" };
  if (file.size > MAX_BYTES) return { error: "截图文件过大（上限 8MB）。" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString("base64");

  const supabase = await createClient();
  const ext = mimeType.split("/")[1];
  const path = `${topicId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("publish-screenshots")
    .upload(path, bytes, { contentType: mimeType });
  if (uploadError) return { error: "截图上传失败，请重试。" };

  const result = await runPerformanceAnalysisTask({ base64, mimeType }, platform);

  if (isRouterResolutionFailure(result)) {
    return { error: `截图已保存，但读取数字失败：${result.error}` };
  }

  const model = getModel(result.provider, result.modelId);
  await writeUsageLog(supabase, {
    workflow_type: "performance_analysis",
    model_alias: `${result.provider}/${result.modelId}`,
    topic_id: topicId,
    platform,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    latency_ms: result.latencyMs,
    success: result.ok,
    error: result.ok ? null : result.error,
    provider: result.provider,
    task_type: "PERFORMANCE_ANALYSIS",
    digital_employee: TASK_TYPE_EMPLOYEE.PERFORMANCE_ANALYSIS,
    pricing_type_at_execution: model?.pricingType ?? null,
  });

  if (!result.ok || !result.data) {
    return { error: `截图已保存，但读取数字失败：${result.error}` };
  }

  const { error: insertError } = await supabase.from("publish_performance").insert({
    topic_id: topicId,
    platform,
    screenshot_path: path,
    extracted_metrics: result.data,
    analysis_note: result.data.other_notes,
    model_alias: `${result.provider}/${result.modelId}`,
    provider: result.provider,
    created_by: user.id,
  });
  if (insertError) return { error: "数据保存失败，请重试。" };

  revalidatePath("/team/analyst");
  revalidatePath("/");
  return { error: null };
}
