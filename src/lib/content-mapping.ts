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

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * What a compliance reviewer must actually see — every field that ends up
 * genuinely public when this asset is published, and nothing else. Round 9
 * P0 fix: `runComplianceReview` used to pass only `asset.content` (the
 * plain body column) to the model, which for VIDEO_CHANNEL and
 * xiaohongshu_post silently skipped `publish_title`/`publish_caption`/
 * `cover_highlights` — fields a viewer genuinely sees on the published
 * post/video, just never folded into the `content` column. Keyed by
 * `content_type`, not `platform`, because XIAOHONGSHU has two lineages
 * with completely different fields (xiaohongshu_post vs xiaohongshu_pages).
 * Deliberately excludes `source_references`/`expert_review_notes` and any
 * other internal metadata — those are never shown to a reader. Falls back
 * to `asset.content` for a content_type this function doesn't recognize
 * (the legacy wechat_outline/wechat_full_article shapes, which the
 * automated pipeline never produces but a manual re-review from
 * /team/compliance could still reach), so nothing regresses to reviewing
 * no text at all.
 */
export function buildPublishFacingTextForCompliance(asset: {
  content_type: ContentType;
  content: string;
  structured_content: Record<string, unknown> | null;
}): string {
  const c = asset.structured_content ?? {};
  let parts: string[];
  switch (asset.content_type) {
    case "video_script":
      parts = [asText(c.publish_title), asText(c.publish_caption), asText(c.full_script), asText(c.cover_text), ...asTextArray(c.cover_highlights)];
      break;
    case "xiaohongshu_post":
      parts = [...asTextArray(c.title_options), asText(c.cover_title), asText(c.caption), ...asTextArray(c.keywords)];
      break;
    case "xiaohongshu_pages":
      parts = [...asTextArray(c.pages)];
      break;
    case "wechat_article":
      parts = [asText(c.title), asText(c.full_article), asText(c.closing_note), asText(c.cover_title), asText(c.cover_subtitle), asText(c.share_caption)];
      break;
    default:
      return asset.content;
  }
  return parts.filter((p) => p.length > 0).join("\n\n");
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
