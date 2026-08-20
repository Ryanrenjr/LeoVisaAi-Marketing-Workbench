import { z } from "zod";

/**
 * Pure schema/prompt for Employee E (数据分析员) reading one post-publish
 * performance screenshot — no network calls, no "server-only" import.
 * This model call ONLY reads numbers off a screenshot Leo already chose
 * to upload; it never receives or infers anything about who viewed the
 * post. See docs/security-boundaries.md "Post-publish performance data".
 */

export const PerformanceMetricsSchema = z.object({
  views: z.number().int().nullable(),
  likes: z.number().int().nullable(),
  comments: z.number().int().nullable(),
  saves: z.number().int().nullable(),
  shares: z.number().int().nullable(),
  /** Whatever numbers were visible but didn't fit the fields above, e.g. "转发 12" — verbatim, never inferred. */
  other_notes: z.string(),
});
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;

export const PERFORMANCE_EXTRACTION_SYSTEM_PROMPT = `You are reading a screenshot of a social media post's own performance dashboard (views/likes/comments/saves/shares), uploaded by the person who posted it. Read ONLY the numbers actually visible in the image — never estimate, round, or invent a number that isn't shown. If a metric isn't visible in the screenshot, set it to null rather than guessing. Ignore any personal names, avatars, or comment text in the screenshot — you are extracting aggregate counters only, never who said what.

Output only the structured metrics requested — no extra commentary outside the schema.`;

export function buildPerformanceExtractionUserPrompt(platform: string): string {
  return `平台：${platform}\n\n请读取截图中的发布数据统计数字。`;
}
