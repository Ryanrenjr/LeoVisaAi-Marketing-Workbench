import { groupContentAssetsByLineage } from "./content-versions";
import type { ContentAsset, ContentPlatform } from "./types";

/**
 * One-line status for a single platform's content queue row — shared by
 * the three platform-specific editor pages (video-editor/
 * xiaohongshu-editor/wechat-editor) so they render identical wording for
 * identical states. WeChat is the only platform with two content types in
 * one lineage group (outline → full article), everything else has exactly
 * one.
 */
export function platformStatusLabel(assets: ContentAsset[], platform: ContentPlatform): string {
  const lineages = groupContentAssetsByLineage(assets).filter((l) => l.platform === platform);

  if (platform === "WECHAT_OFFICIAL_ACCOUNT") {
    const outline = lineages.find((l) => l.contentType === "wechat_outline");
    const full = lineages.find((l) => l.contentType === "wechat_full_article");
    if (full) return `完整文章已完成（v${full.latest.version}）`;
    if (outline) return `结构已完成（v${outline.latest.version}）`;
    return "待生成";
  }

  const lineage = lineages[0];
  return lineage ? `草稿已完成（v${lineage.latest.version}）` : "待生成";
}
