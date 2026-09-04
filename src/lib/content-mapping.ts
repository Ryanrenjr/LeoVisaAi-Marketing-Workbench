import type { ContentPlatform, ContentType } from "./types";
import type { RevisionTaskType } from "./ai/content-schemas";
import type { BrandConfig } from "./brand-defaults";

/**
 * Pure field-mapping helpers for content_assets — no Supabase, no
 * server-only, so directly unit-testable. Lives outside
 * content-actions.ts/revision-actions.ts because a "use server" file may
 * only export async functions.
 */

/**
 * Which CONTENT TYPE maps to which revision task — only the CURRENT
 * (non-legacy) content types have a revision schema; an asset still on
 * the old wechat_outline/wechat_full_article shape must be edited by hand
 * (editContentAsset), not revised by AI. Keyed by content_type rather
 * than platform because XIAOHONGSHU now has two independently-revisable
 * lineages (xiaohongshu_post and xiaohongshu_pages — live user
 * instruction split what used to be one combined draft into a
 * title/caption piece and a separate per-page image-text plan). Shared by
 * revision-actions.ts (the actual dispatch) and the reviser team page /
 * topic detail page (deciding whether to show an enabled "生成修改版"
 * button).
 */
export const CONTENT_TYPE_REVISION: Partial<Record<ContentType, RevisionTaskType>> = {
  video_script: "VIDEO_REVISION",
  xiaohongshu_post: "XIAOHONGSHU_REVISION",
  xiaohongshu_pages: "XIAOHONGSHU_PAGES_REVISION",
  wechat_article: "WECHAT_ARTICLE_REVISION",
};

/**
 * The task-specific system prompt (`WECHAT_ARTICLE_SYSTEM_PROMPT`,
 * content-schemas.ts) deliberately tells the model NOT to write the brand
 * footer itself — "which is appended separately". This is that separate
 * step: a plain date stamp + the configured `wechatFooter` (which already
 * contains the company name), built deterministically from real
 * `brand_config`, never guessed by the model. See E｜公众号编辑员's Skill
 * "DATE REQUIREMENT" / "COMPANY BRAND REQUIREMENT" and
 * `src/lib/brand-validation.ts`.
 */
export function buildWechatBrandFooter(brand: Pick<BrandConfig, "wechatFooter">): string {
  const today = new Date().toISOString().slice(0, 10);
  return `最后核验：${today}\n\n${brand.wechatFooter}`;
}

/** Derives the plain `title`/`content` columns from a freshly-generated structured content object. */
export function deriveTitleAndContent(
  platform: ContentPlatform,
  content: Record<string, unknown>,
): { title: string; content: string } {
  if (platform === "VIDEO_CHANNEL") {
    return { title: String(content.title ?? ""), content: String(content.full_script ?? "") };
  }
  if (platform === "XIAOHONGSHU") {
    // xiaohongshu_pages (图文规划, no title_options) vs xiaohongshu_post
    // (title/caption, no pages) — disambiguated structurally, same
    // pattern as WECHAT_OFFICIAL_ACCOUNT's outline/full-article check
    // below.
    if ("pages" in content) {
      const pages = (content.pages as string[] | undefined) ?? [];
      return { title: `图文规划（共 ${pages.length} 页）`, content: pages.join("\n\n") };
    }
    const titleOptions = (content.title_options as string[] | undefined) ?? [];
    return { title: titleOptions[0] ?? String(content.cover_title ?? ""), content: String(content.caption ?? "") };
  }
  // WECHAT_OFFICIAL_ACCOUNT — the current direct-article shape has a
  // separate closing_note (rendered after full_article, before the brand
  // footer) and a `brand_footer` injected by the caller (see
  // buildWechatBrandFooter above) before this ever runs — join all three
  // so the flat `content` column (downloads, compliance scanning) matches
  // what the UI shows as three separate fields. The legacy
  // wechat_full_article shape has neither field, so this degrades to the
  // old "just full_article" behavior automatically.
  if ("closing_note" in content) {
    return {
      title: String(content.title ?? ""),
      content: [content.full_article, content.closing_note, content.brand_footer]
        .filter((part): part is string => typeof part === "string" && part.length > 0)
        .join("\n\n"),
    };
  }
  return { title: String(content.title ?? ""), content: String(content.full_article ?? "") };
}

/**
 * Merges a human edit (plain title + body) back into the structured
 * content shape, so the tab view stays consistent with what was edited.
 * Only the title/body fields change — sources and expert_review_notes
 * are preserved as-is from the AI-generated version being edited.
 */
export function mergeEditIntoStructuredContent(
  platform: ContentPlatform,
  structured: Record<string, unknown>,
  title: string,
  content: string,
): Record<string, unknown> {
  if (platform === "VIDEO_CHANNEL") {
    return { ...structured, title, full_script: content };
  }
  if (platform === "XIAOHONGSHU") {
    if ("pages" in structured) {
      return { ...structured, pages: content.split(/\n{2,}/).filter((p) => p.trim().length > 0) };
    }
    const titleOptions = [...((structured.title_options as string[] | undefined) ?? [])];
    titleOptions[0] = title;
    return { ...structured, title_options: titleOptions, cover_title: title, caption: content };
  }
  // WECHAT_OFFICIAL_ACCOUNT — could be an outline or a full article; both
  // keep a title_options array on the outline and a plain title on the
  // full article, so check which shape this asset actually has.
  if ("full_article" in structured) {
    return { ...structured, title, full_article: content };
  }
  const titleOptions = [...((structured.title_options as string[] | undefined) ?? [])];
  titleOptions[0] = title;
  return { ...structured, title_options: titleOptions, summary: content };
}
