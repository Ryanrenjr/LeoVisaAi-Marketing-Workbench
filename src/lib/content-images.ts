import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { ContentImageRow } from "./types";

/**
 * Data access for Employee 小红书图片设计员 (image-designer)
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
