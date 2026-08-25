import type { VideoChannelContent, XiaohongshuContent, XiaohongshuPagesPlan, WechatFullArticle } from "./ai/content-schemas";
import type { BrandConfig } from "./brand-defaults";

/**
 * Deterministic (non-AI) brand checks — Skill spec Section 11 "PLATFORM
 * BRAND VALIDATION": "Do not rely only on the AI remembering these
 * requirements." Pure string checks, run after generation, never block
 * anything — a missing item is a yellow notice for the human reviewer
 * (see brand-check-notice.tsx), not a hard gate, since brand wording can
 * legitimately have edge-case exceptions.
 *
 * Each function returns what's MISSING — an empty array means the check
 * passed. "Contains" checks are intentionally loose (a short distinctive
 * substring of the configured text, e.g. the expert name or brand handle)
 * so a lightly-reworded outro/footer that keeps the substantive brand
 * marker still passes, instead of demanding byte-for-byte match against
 * ADMIN-edited free text.
 */

const LAST_VERIFIED_PATTERN = /最后核验[：:]\s*\d{4}-\d{2}-\d{2}/;

export function validateVideoScript(content: Pick<VideoChannelContent, "full_script">, brand: BrandConfig): string[] {
  const issues: string[] = [];
  if (brand.expertName && !content.full_script.includes(brand.expertName)) {
    issues.push(`口播稿未出现品牌 Outro（缺少"${brand.expertName}"）。`);
  }
  return issues;
}

export function validateXiaohongshuPost(content: Pick<XiaohongshuContent, "caption">, brand: BrandConfig): string[] {
  const issues: string[] = [];
  const hasExpertName = brand.expertName && content.caption.includes(brand.expertName);
  const hasContentBrand = brand.contentBrand && content.caption.includes(brand.contentBrand);
  if (!hasExpertName && !hasContentBrand) {
    issues.push(`发布文案未出现品牌标识（缺少"${brand.expertName}"或"${brand.contentBrand}"）。`);
  }
  return issues;
}

/** The 图文规划 (per-page plan) has its own brand check — the last page, not the caption, is where the brand outro shows up in the actual carousel. */
export function validateXiaohongshuPagesPlan(
  content: Pick<XiaohongshuPagesPlan, "pages">,
  brand: BrandConfig,
): string[] {
  const issues: string[] = [];
  const lastPage = content.pages[content.pages.length - 1] ?? "";
  const hasExpertName = brand.expertName && lastPage.includes(brand.expertName);
  const hasContentBrand = brand.contentBrand && lastPage.includes(brand.contentBrand);
  if (!hasExpertName && !hasContentBrand) {
    issues.push(`末页未出现品牌标识（缺少"${brand.expertName}"或"${brand.contentBrand}"）。`);
  }
  return issues;
}

export function validateWechatArticle(content: Pick<WechatFullArticle, "full_article">, brand: BrandConfig): string[] {
  const issues: string[] = [];
  const text = content.full_article;

  const hasCompanyName =
    (brand.companyNameEn && text.includes(brand.companyNameEn)) ||
    (brand.companyNameZh && text.includes(brand.companyNameZh));
  if (!hasCompanyName) {
    issues.push(`文章未出现公司名称（缺少"${brand.companyNameEn}"或"${brand.companyNameZh}"）。`);
  }

  if (!LAST_VERIFIED_PATTERN.test(text)) {
    issues.push('文章未包含"最后核验：YYYY-MM-DD"格式的核验日期。');
  }

  if (brand.wechatFooter) {
    const footerMarker = brand.wechatFooter.slice(0, 12);
    if (!text.includes(footerMarker)) {
      issues.push("文章未包含配置的公众号底部品牌 Footer。");
    }
  }

  return issues;
}
