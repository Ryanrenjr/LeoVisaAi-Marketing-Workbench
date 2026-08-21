/**
 * Pure query-building for the video-editor/wechat-editor "搜索配图"
 * feature — no network calls, no AI call. Extracts search-worthy phrases
 * straight out of the already-generated draft, mirroring how
 * research-queries.ts/topic-discovery.ts build deterministic query lists.
 * Kept short (1-2 queries) since the Google image search free tier is
 * only 100 queries/day — see docs/search-router.md.
 */

export function buildVideoImageSearchQueries(content: { title: string; evidence_visuals: string[] }): string[] {
  const queries = [content.title, ...content.evidence_visuals.slice(0, 1)];
  return queries.filter((q) => q.trim().length > 0).slice(0, 2);
}

export function buildWechatImageSearchQueries(content: { title_options: string[]; key_claims: string[] }): string[] {
  const queries = [content.title_options[0], ...content.key_claims.slice(0, 1)];
  return queries.filter((q) => q.trim().length > 0).slice(0, 2);
}
