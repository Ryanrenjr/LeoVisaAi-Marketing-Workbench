import type { ContentPlatform, ContentType } from "./types";
import type { RevisionTaskType } from "./ai/content-schemas";

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
  // WECHAT_OFFICIAL_ACCOUNT — direct article generation (title + full_article).
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
