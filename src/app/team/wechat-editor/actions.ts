"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { canManageContentAssets } from "@/lib/permissions";
import { getContentAssets, getTopicById } from "@/lib/topics";
import { getLatestForLineage } from "@/lib/content-versions";
import { buildWechatImageSearchQueries } from "@/lib/ai/image-search-queries";
import { runImageSearch } from "@/lib/search/image-router";
import { writeSearchUsageLog } from "@/lib/ai/usage-log";
import type { WechatOutline } from "@/lib/ai/content-schemas";

/**
 * Searches Google Images for real reference photos matching the topic's
 * already-generated 公众号 outline, downloads and re-hosts them into the
 * private content-images bucket (never links directly to a third-party
 * URL — see supabase/migrations/0010_image_search.sql). ADMIN-only, same
 * gate as every other content-generation action. Unlike image-designer's
 * AI generation, this never calls an AI model — Search Router only.
 */
export async function searchAndAttachImages(topicId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!canManageContentAssets(user.role)) throw new Error("Forbidden: ADMIN role required");

  const topic = await getTopicById(topicId);
  if (!topic) return { ok: false, error: "未找到选题。" };

  const assets = await getContentAssets(topicId);
  const outline = getLatestForLineage(assets, "WECHAT_OFFICIAL_ACCOUNT", "wechat_outline");
  if (!outline) return { ok: false, error: "请先生成公众号大纲，再搜索配图。" };

  const content = outline.structured_content as unknown as WechatOutline;
  const queries = buildWechatImageSearchQueries(content);

  const started = Date.now();
  const result = await runImageSearch(queries);
  const supabase = await createClient();

  if (!result.ok) {
    await writeSearchUsageLog(supabase, {
      provider: "GOOGLE_IMAGES",
      digital_employee: "wechat-editor",
      task_type: "IMAGE_SEARCH",
      topic_id: topicId,
      query_count: queries.length,
      result_count: 0,
      latency_ms: Date.now() - started,
      success: false,
      error: result.error,
    });
    return { ok: false, error: result.error };
  }

  let savedCount = 0;
  for (const execution of result.executions) {
    for (const image of execution.results) {
      try {
        const response = await fetch(image.downloadUrl);
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        const ext = image.downloadUrl.split(".").pop()?.split("?")[0]?.slice(0, 4) || "jpg";
        const path = `${topicId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("content-images")
          .upload(path, bytes, { contentType: response.headers.get("content-type") ?? "image/jpeg" });
        if (uploadError) continue;

        const { error: insertError } = await supabase.from("content_images").insert({
          topic_id: topicId,
          content_asset_id: outline.id,
          prompt: execution.query,
          image_path: path,
          provider: "GOOGLE_IMAGES",
          source: "searched",
          search_query: execution.query,
          external_source_url: image.sourcePageUrl,
          created_by: user.id,
        });
        if (!insertError) savedCount++;
      } catch {
        // one failed download/upload shouldn't block the rest of the batch
      }
    }
  }

  const totalResults = result.executions.reduce((sum, e) => sum + e.results.length, 0);
  await writeSearchUsageLog(supabase, {
    provider: "GOOGLE_IMAGES",
    digital_employee: "wechat-editor",
    task_type: "IMAGE_SEARCH",
    topic_id: topicId,
    query_count: queries.length,
    result_count: totalResults,
    latency_ms: Date.now() - started,
    success: true,
    error: null,
  });

  if (savedCount === 0) return { ok: false, error: "找到了图片，但保存失败，请重试。" };

  revalidatePath("/team/wechat-editor");
  revalidatePath(`/topics/${topicId}`);
  return { ok: true };
}
