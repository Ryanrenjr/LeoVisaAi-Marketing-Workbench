import type { ContentPlatform } from "./types";

/**
 * Pure field-mapping helpers for content_assets — no Supabase, no
 * server-only, so directly unit-testable. Lives outside
 * content-actions.ts because a "use server" file may only export async
 * functions.
 */

/** Derives the plain `title`/`content` columns from a freshly-generated structured content object. */
export function deriveTitleAndContent(
  platform: ContentPlatform,
  content: Record<string, unknown>,
): { title: string; content: string } {
  if (platform === "VIDEO_CHANNEL") {
    return { title: String(content.title ?? ""), content: String(content.full_script ?? "") };
  }
  if (platform === "XIAOHONGSHU") {
    const titleOptions = (content.title_options as string[] | undefined) ?? [];
    const pages = (content.pages as string[] | undefined) ?? [];
    return { title: titleOptions[0] ?? String(content.cover_title ?? ""), content: pages.join("\n\n") };
  }
  // WECHAT_OFFICIAL_ACCOUNT (outline) — the full-article lineage is
  // derived directly at its own call site, not through this function.
  const titleOptions = (content.title_options as string[] | undefined) ?? [];
  return { title: titleOptions[0] ?? "", content: String(content.summary ?? "") };
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
    const titleOptions = [...((structured.title_options as string[] | undefined) ?? [])];
    titleOptions[0] = title;
    return {
      ...structured,
      title_options: titleOptions,
      cover_title: title,
      pages: content.split(/\n{2,}/).filter((p) => p.trim().length > 0),
    };
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
