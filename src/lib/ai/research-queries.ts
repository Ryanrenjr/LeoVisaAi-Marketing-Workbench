/**
 * Pure query-generation and result-ranking for the external-search
 * Research path — no network, no "server-only" import, fully
 * unit-testable. Deliberately a deterministic template rather than an
 * extra LLM call: cheap, predictable, and avoids spending model quota
 * just to decide what to search for (see docs/search-router.md
 * "Query strategy").
 */

export const PRIMARY_SOURCE_DOMAINS: readonly string[] = [
  "gov.uk",
  "parliament.uk",
  "legislation.gov.uk",
  "gov.scot",
  "immigrationadviceauthority.gov.uk",
];

/** Kept small deliberately — this is a smoke-test-stage development budget, not a research-depth ceiling. See docs/search-router.md "Query strategy". */
const MAX_QUERIES = 3;

/** Derives up to 3 targeted queries from topic context (title, question, business, audience) — never hard-codes an answer, only a search template. */
export function buildResearchQueries(topic: {
  title: string;
  question: string;
  business: string;
  audience: string;
}): string[] {
  const base = (topic.question || topic.title).trim();
  const candidates = [
    `${base} gov.uk`,
    `${topic.title} Immigration Rules ${topic.business}`.trim(),
    `${base} Home Office guidance ${topic.audience}`.trim(),
  ].filter((q): q is string => Boolean(q && q.trim()));

  const deduped = Array.from(new Set(candidates));
  return deduped.slice(0, MAX_QUERIES);
}

export function isPrimarySourceUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
  return PRIMARY_SOURCE_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/**
 * Boosts primary-source results to the front without discarding secondary
 * sources — they may still help discovery (spec: "do not automatically
 * discard all secondary sources"). Stable sort: relative order within
 * each group (primary / non-primary) is preserved.
 */
export function rankSearchResults<T extends { url: string }>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => Number(isPrimarySourceUrl(b.url)) - Number(isPrimarySourceUrl(a.url)));
}
