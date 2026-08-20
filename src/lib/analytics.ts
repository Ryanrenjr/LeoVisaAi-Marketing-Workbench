import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { PublishPerformanceRow } from "./types";

/**
 * Data access for Employee E's post-publish performance data
 * (publish_performance table + the private 'publish-screenshots' storage
 * bucket — see supabase/migrations/0008_digital_employee_expansion.sql
 * and docs/security-boundaries.md "Post-publish performance data").
 */

export async function getAllPublishPerformance(): Promise<PublishPerformanceRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("publish_performance")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

export async function getPublishPerformanceForTopic(topicId: string): Promise<PublishPerformanceRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("publish_performance")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

/** For the Boss Home employee card's stat line — total rows on record. */
export async function getRecentPublishPerformanceCount(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from("publish_performance")
    .select("*", { count: "exact", head: true });

  if (error || count === null) return 0;
  return count;
}

/**
 * A signed, short-lived URL for one screenshot — the bucket is private,
 * so this is the only way to display it in the browser. Never returns a
 * permanent public URL.
 */
export async function getScreenshotSignedUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("publish-screenshots")
    .createSignedUrl(path, 60 * 10);

  if (error || !data) return null;
  return data.signedUrl;
}
