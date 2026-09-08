import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { ContentImageRow } from "./types";

/**
 * Data access for Employee 图片设计员 (image-designer)
 * (content_images table + the private 'content-images' storage bucket —
 * see supabase/migrations/0009_editor_split_and_image_designer.sql).
 * Mirrors analytics.ts's shape for publish_performance/publish-screenshots.
 */

export async function getContentImagesForTopic(topicId: string): Promise<ContentImageRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_images")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

export async function getAllContentImages(): Promise<ContentImageRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_images")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

/**
 * A signed, short-lived URL for one generated image — the bucket is
 * private, so this is the only way to display/download it in the browser.
 * Never returns a permanent public URL.
 */
export async function getContentImageSignedUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("content-images").createSignedUrl(path, 60 * 10);

  if (error || !data) return null;
  return data.signedUrl;
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Shared save step for one generated cover/carousel image — upload to
 * storage, insert the row. Used by both image-designer/actions.ts
 * (covers) and xiaohongshu-image-planner/actions.ts (图文 carousel), so
 * it lives here rather than duplicated or owned by just one employee's
 * action file.
 */
export async function saveGeneratedContentImage(
  supabase: SupabaseServerClient,
  params: {
    topicId: string;
    contentAssetId: string;
    prompt: string;
    imageBase64: string;
    provider: string;
    modelId: string;
    userId: string;
    imageKind: "cover" | "carousel";
    pageIndex: number | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const bytes = Buffer.from(params.imageBase64, "base64");
  const path = `${params.topicId}/${Date.now()}-${crypto.randomUUID()}.png`;

  const { error: uploadError } = await supabase.storage
    .from("content-images")
    .upload(path, bytes, { contentType: "image/png" });
  if (uploadError) return { ok: false, error: "图片已生成，但保存失败，请重试。" };

  const { error: insertError } = await supabase.from("content_images").insert({
    topic_id: params.topicId,
    content_asset_id: params.contentAssetId,
    prompt: params.prompt,
    image_path: path,
    model_alias: `${params.provider}/${params.modelId}`,
    provider: params.provider,
    created_by: params.userId,
    image_kind: params.imageKind,
    page_index: params.pageIndex,
  });
  if (insertError) {
    // The file already landed in Storage but nothing in content_images
    // points at it — left alone, it's an orphan discardTopic() can never
    // find and delete, which breaks the "nothing survives a topic's
    // session" guarantee. Best-effort compensating delete before
    // surfacing the error.
    const { error: cleanupError } = await supabase.storage.from("content-images").remove([path]);
    const suffix = cleanupError ? "，清理临时文件也失败，请联系管理员处理" : "";
    return { ok: false, error: `图片已生成，但记录保存失败，请重试${suffix}。` };
  }
  return { ok: true };
}
