import type { ContentPillar, PublishPerformanceRow, Topic } from "./types";

/**
 * Pure aggregation of real publish_performance rows into "which content
 * pillar performs best" — no network calls. Deliberately NOT another AI
 * call: averaging real numbers is more trustworthy than an LLM guessing
 * insights from a handful of data points, and it can never fabricate a
 * number the way a summarization pass could.
 */

export interface PillarPerformance {
  pillar: ContentPillar | "unset";
  postCount: number;
  avgViews: number | null;
  avgLikes: number | null;
}

function avgOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export function computePillarPerformance(
  performance: PublishPerformanceRow[],
  topicsById: Map<string, Topic>,
): PillarPerformance[] {
  const byPillar = new Map<ContentPillar | "unset", { views: number[]; likes: number[] }>();

  for (const row of performance) {
    const topic = topicsById.get(row.topic_id);
    const pillar = topic?.content_pillar ?? "unset";
    const bucket = byPillar.get(pillar) ?? { views: [], likes: [] };
    const metrics = row.extracted_metrics as { views?: number | null; likes?: number | null };
    if (typeof metrics.views === "number") bucket.views.push(metrics.views);
    if (typeof metrics.likes === "number") bucket.likes.push(metrics.likes);
    byPillar.set(pillar, bucket);
  }

  return Array.from(byPillar.entries())
    .map(([pillar, bucket]) => ({
      pillar,
      postCount: Math.max(bucket.views.length, bucket.likes.length),
      avgViews: avgOf(bucket.views),
      avgLikes: avgOf(bucket.likes),
    }))
    .sort((a, b) => (b.avgViews ?? 0) - (a.avgViews ?? 0));
}
