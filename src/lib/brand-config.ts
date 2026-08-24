import "server-only";
import { createClient } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/config";
import { DEFAULT_BRAND_CONFIG } from "./brand-defaults";
import type { BrandConfig } from "./brand-defaults";

export type { BrandConfig } from "./brand-defaults";
export { DEFAULT_BRAND_CONFIG } from "./brand-defaults";

/**
 * ADMIN-editable company brand configuration (brand_config table — see
 * supabase/migrations/0013_skill_versioning_and_brand_config.sql). Same
 * "DB overrides code default" pattern as employee-names.ts — a missing key
 * just falls back to DEFAULT_BRAND_CONFIG, so demo mode (no Supabase) and a
 * freshly-migrated DB both work with no setup. Not versioned (unlike
 * employee_instructions) — the live spec only asked for Skill versioning.
 */

const BRAND_CONFIG_KEYS = [
  "company_name_en",
  "company_name_zh",
  "content_brand",
  "expert_name",
  "video_outro",
  "wechat_footer",
] as const;

export async function getBrandConfig(): Promise<BrandConfig> {
  if (!isSupabaseConfigured()) return DEFAULT_BRAND_CONFIG;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("brand_config")
    .select("key, value")
    .in("key", BRAND_CONFIG_KEYS);
  if (error || !data) return DEFAULT_BRAND_CONFIG;

  const overrides = new Map(data.map((row) => [row.key as string, row.value as string]));
  return {
    companyNameEn: overrides.get("company_name_en") ?? DEFAULT_BRAND_CONFIG.companyNameEn,
    companyNameZh: overrides.get("company_name_zh") ?? DEFAULT_BRAND_CONFIG.companyNameZh,
    contentBrand: overrides.get("content_brand") ?? DEFAULT_BRAND_CONFIG.contentBrand,
    expertName: overrides.get("expert_name") ?? DEFAULT_BRAND_CONFIG.expertName,
    videoOutro: overrides.get("video_outro") ?? DEFAULT_BRAND_CONFIG.videoOutro,
    wechatFooter: overrides.get("wechat_footer") ?? DEFAULT_BRAND_CONFIG.wechatFooter,
  };
}
