import type { ContentAsset, ContentPlatform, ContentType, ResearchSource } from "./types";

/**
 * Pure version-bookkeeping for content_assets — no Supabase, so it's
 * directly unit-testable. A "lineage" is one (platform, content_type)
 * pair; regenerating or editing always adds a new row to its lineage
 * rather than overwriting anything. See docs/phase-4-plan.md "Versioning".
 */

export interface ContentLineage {
  platform: ContentPlatform;
  contentType: ContentType;
  latest: ContentAsset;
  /** All versions in this lineage, newest first, including `latest`. */
  history: ContentAsset[];
}

function lineageKey(platform: ContentPlatform, contentType: ContentType): string {
  return `${platform}::${contentType}`;
}

export function groupContentAssetsByLineage(assets: ContentAsset[]): ContentLineage[] {
  const byLineage = new Map<string, ContentAsset[]>();
  for (const asset of assets) {
    const key = lineageKey(asset.platform, asset.content_type);
    const list = byLineage.get(key);
    if (list) list.push(asset);
    else byLineage.set(key, [asset]);
  }

  return Array.from(byLineage.values()).map((list) => {
    const history = [...list].sort((a, b) => b.version - a.version);
    return { platform: history[0].platform, contentType: history[0].content_type, latest: history[0], history };
  });
}

export function getLatestForLineage(
  assets: ContentAsset[],
  platform: ContentPlatform,
  contentType: ContentType,
): ContentAsset | null {
  let latest: ContentAsset | null = null;
  for (const asset of assets) {
    if (asset.platform !== platform || asset.content_type !== contentType) continue;
    if (!latest || asset.version > latest.version) latest = asset;
  }
  return latest;
}

/** The version number the next generation/edit in this lineage should use. */
export function nextVersionNumber(
  assets: ContentAsset[],
  platform: ContentPlatform,
  contentType: ContentType,
): number {
  const latest = getLatestForLineage(assets, platform, contentType);
  return latest ? latest.version + 1 : 1;
}

/**
 * Groups research sources by the research_pack_id they belong to, so a
 * content asset can resolve its `source_references` against the exact
 * pack it was generated from — never the topic's current/latest pack.
 * See docs/phase-4-plan.md "Source traceability".
 *
 * This matters across time: if a topic's research is re-run and approved
 * again (a new research_packs row), older content_assets rows still carry
 * the OLD research_pack_id they were generated from, and must keep
 * resolving against that pack's sources, not the new one.
 */
export function groupSourcesByPackId(sources: ResearchSource[]): Map<string, ResearchSource[]> {
  const byPackId = new Map<string, ResearchSource[]>();
  for (const source of sources) {
    const list = byPackId.get(source.research_pack_id);
    if (list) list.push(source);
    else byPackId.set(source.research_pack_id, [source]);
  }
  return byPackId;
}

/** The sources a specific content asset should display — from its own research_pack_id only. */
export function sourcesForAsset(
  asset: ContentAsset,
  sourcesByPackId: Map<string, ResearchSource[]>,
): ResearchSource[] {
  return sourcesByPackId.get(asset.research_pack_id) ?? [];
}

/** Groups a flat content_assets list (e.g. from getAllContentAssets()) by topic_id. */
export function groupContentAssetsByTopicId(assets: ContentAsset[]): Map<string, ContentAsset[]> {
  const byTopicId = new Map<string, ContentAsset[]>();
  for (const asset of assets) {
    const list = byTopicId.get(asset.topic_id);
    if (list) list.push(asset);
    else byTopicId.set(asset.topic_id, [asset]);
  }
  return byTopicId;
}
