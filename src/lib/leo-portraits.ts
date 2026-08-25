import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import type { LeoPortraitRow } from "./types";

/**
 * Data access for Leo's real reference photos (leo_portraits table + the
 * private 'leo-portraits' storage bucket — see
 * supabase/migrations/0017_leo_portraits.sql). Mirrors content-images.ts's
 * shape. These are ADMIN-uploaded real photos, never AI-generated — sent
 * as a reference image to the Images EDIT endpoint (see
 * generateOpenAIImageEdit in src/lib/ai/providers/openai-provider.ts) so
 * the model fuses his real likeness into a generated cover.
 */

export async function getLeoPortraits(): Promise<LeoPortraitRow[]> {
  if (!isSupabaseConfigured()) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leo_portraits")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return [];
  return data;
}

/** The most recently uploaded portrait — the one used whenever "带特写" is checked, no per-generation picker. */
export async function getLatestLeoPortrait(): Promise<LeoPortraitRow | null> {
  const portraits = await getLeoPortraits();
  return portraits[0] ?? null;
}

/**
 * A signed, short-lived URL for one portrait — the bucket is private, so
 * this is the only way to display/download it in the browser. Never
 * returns a permanent public URL.
 */
export async function getLeoPortraitSignedUrl(path: string): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("leo-portraits").createSignedUrl(path, 60 * 10);

  if (error || !data) return null;
  return data.signedUrl;
}
