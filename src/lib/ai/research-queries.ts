import type { ResearchSearchLane, ResearchSearchQuery } from "../search/types";
import type { ResearchScoreBreakdown } from "../types";

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

/**
 * Round 4B — official-first Research Search. A real production run
 * showed the old approach (appending "gov.uk" / "Home Office guidance"
 * as text keywords onto the query) failing on a Chinese-language
 * question: Tavily matched the literal domain string and returned
 * `https://www.gov.uk`'s bare homepage instead of any relevant page,
 * even though the real page (`gov.uk/returning-resident-visa`) existed
 * and was findable with a domain-restricted search. "Official domain"
 * should be expressed through the Search Provider's own domain-filtering
 * capability (Tavily's `include_domains`), not a text suffix.
 *
 * Three deterministic search queries (never an extra LLM call to decide
 * them):
 * 1. Official primary search — the real question/title itself, restricted
 *    to PRIMARY_SOURCE_DOMAINS via includeDomains.
 * 2. Official legal/guidance search — the same topic with a light legal-
 *    retrieval-intent phrase ("Immigration Rules"), still restricted to
 *    PRIMARY_SOURCE_DOMAINS — catches cases where the bare question
 *    doesn't match official wording but a legal-intent phrasing does.
 * 3. General secondary search — the same question, no domain restriction,
 *    for professional commentary / common misconceptions / news
 *    background (never allowed to outrank an official extract — see
 *    EXTERNAL_RESEARCH_SYSTEM_PROMPT's evidence hierarchy).
 *
 * Never hard-codes a topic-specific answer or term (e.g. "returning
 * resident", "lapse of ILR") — only real topic context in, a search
 * template out, generic across Student Visa / Skilled Worker / ILR /
 * EUSS / Visitor / Citizenship / eVisa / any other topic.
 */
export function buildResearchSearchQueries(topic: {
  title: string;
  question: string;
  business: string;
  audience: string;
}): ResearchSearchQuery[] {
  const base = (topic.question || topic.title).trim();
  const guidanceQuery = `${topic.title} Immigration Rules ${topic.business}`.trim();

  const candidates: (ResearchSearchQuery | null)[] = [
    base ? { query: base, includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_PRIMARY" as const } : null,
    guidanceQuery ? { query: guidanceQuery, includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_LEGAL" as const } : null,
    base ? { query: base, lane: "GENERAL" as const } : null,
  ];
  const nonNullCandidates = candidates.filter((q): q is ResearchSearchQuery => q !== null);

  const seen = new Set<string>();
  const deduped = nonNullCandidates.filter((q) => {
    const key = `${q.query}|${(q.includeDomains ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return deduped.slice(0, MAX_QUERIES);
}

/** Optimization mode's per-run search budget (§六 of the 研究优化 spec) — cost/latency ceiling, not a depth target. */
const MAX_OPTIMIZATION_QUERIES = 6;

function dimensionRatio(item: { score: number; max: number }): number {
  return item.max > 0 ? item.score / item.max : 0;
}

function dedupeQueries(candidates: readonly ResearchSearchQuery[]): ResearchSearchQuery[] {
  const seen = new Set<string>();
  return candidates.filter((q) => {
    const key = `${q.query}|${(q.includeDomains ?? []).join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Research Optimization's search queries are NOT the same three fixed
 * queries buildResearchSearchQueries always runs — re-running those would
 * just reproduce the same evidence gap that produced the low score in the
 * first place. Instead, generate queries targeted at whichever dimensions
 * actually scored low (below 80% of that dimension's max — same "healthy"
 * bar diagnoseResearchScore uses in research-pack.ts, so a dimension that's
 * fine never spends part of the query budget). Deterministic template,
 * same reasoning as buildResearchSearchQueries: cheap, predictable, no
 * extra LLM call just to decide what to search for.
 *
 * Only the three dimensions an extra web search can actually move get a
 * template here (official_sources / policy_timeline / scope_exceptions) —
 * fact_accuracy, data_reliability, and external_safety are about how the
 * existing evidence is reasoned about and written up, not about finding
 * more of it, so they don't have a search-query fix.
 */
export function buildOptimizationSearchQueries(
  topic: { title: string; question: string; business: string; audience: string },
  breakdown: ResearchScoreBreakdown,
  plannedQueries?: readonly ResearchSearchQuery[],
): ResearchSearchQuery[] {
  const base = (topic.question || topic.title).trim();
  if (!base) return [];

  const plannedOfficial = plannedQueries?.find((query) => query.lane === "OFFICIAL_PRIMARY")?.query;
  const plannedLegal = plannedQueries?.find((query) => query.lane === "OFFICIAL_LEGAL")?.query;
  const plannedGeneral = plannedQueries?.find((query) => query.lane === "GENERAL")?.query;
  const officialBase = plannedOfficial ?? base;
  const legalBase = plannedLegal ?? `${base} Home Office guidance Immigration Rules Statement of Changes`;
  const generalBase = plannedGeneral ?? base;

  const candidates: ResearchSearchQuery[] = [];

  if (dimensionRatio(breakdown.officialSources) < 0.8) {
    candidates.push(
      { query: officialBase, includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_PRIMARY" },
      {
        query: legalBase,
        includeDomains: PRIMARY_SOURCE_DOMAINS,
        lane: "OFFICIAL_LEGAL",
      },
    );
  }

  if (dimensionRatio(breakdown.policyTimeline) < 0.8) {
    candidates.push(
      {
        query: `${legalBase} implementation date commencement transitional arrangements`,
        includeDomains: PRIMARY_SOURCE_DOMAINS,
        lane: "OFFICIAL_LEGAL",
      },
      { query: `${generalBase} statement of changes consultation white paper Home Office announcement`, lane: "GENERAL" },
    );
  }

  if (dimensionRatio(breakdown.scopeExceptions) < 0.8) {
    candidates.push(
      {
        query: `${officialBase} existing visa holders transitional arrangements dependants grandfathering`,
        includeDomains: PRIMARY_SOURCE_DOMAINS,
        lane: "OFFICIAL_PRIMARY",
      },
      { query: `${generalBase} EUSS BN(O) current route existing applicants exceptions`, lane: "GENERAL" },
    );
  }

  return dedupeQueries(candidates).slice(0, MAX_OPTIMIZATION_QUERIES);
}

/** De-duplicates search results pooled from multiple queries by URL (Round 4B — the official-only and guidance-only queries can both legitimately return the same official page). Keeps the first occurrence's data. */
export function dedupeSearchResultsByUrl<T extends { url: string }>(results: readonly T[]): T[] {
  const seen = new Set<string>();
  return results.filter((r) => (seen.has(r.url) ? false : (seen.add(r.url), true)));
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

/** Deliberately small (Round 4) — 2-3 official sources are usually enough, and every extraction spends Tavily credits + adds latency + adds tokens to the Sol call. Not a research-depth ceiling, a cost/latency budget. */
export const MAX_OFFICIAL_EXTRACTS = 3;

/** A search result plus which Research Search lane it came from and its rank within that lane's own results (Round 4D) — transient execution-time metadata, never persisted. */
export interface LanedSearchHit<T extends { url: string }> {
  result: T;
  lane: ResearchSearchLane;
  rankWithinQuery: number;
}

/**
 * Zips each execution's results with the lane of the query that produced
 * it (Round 4D). `executions[i]` and `queries[i]` are always the same
 * length and order — `runResearchSearch` runs exactly one execution per
 * query it's given, in order, with no internal filtering — so positional
 * pairing is safe here. A query with no `lane` set (Topic Discovery's
 * plain strings never carry one) defaults to GENERAL, which never wins a
 * priority slot in selectOfficialExtractionTargets.
 */
export function tagSearchHitsByLane<T extends { url: string }>(
  executions: readonly { results: readonly T[] }[],
  queries: readonly ResearchSearchQuery[],
): LanedSearchHit<T>[] {
  const hits: LanedSearchHit<T>[] = [];
  executions.forEach((execution, i) => {
    const lane: ResearchSearchLane = queries[i]?.lane ?? "GENERAL";
    execution.results.forEach((result, rankWithinQuery) => {
      hits.push({ result, lane, rankWithinQuery });
    });
  });
  return hits;
}

/**
 * Round 4D — query-aware official extraction selection. The old
 * flat-pooled-order selection let whichever query happened to be
 * flattened first (always OFFICIAL_PRIMARY, since it's query 1) starve
 * OFFICIAL_LEGAL of every extraction slot even when OFFICIAL_LEGAL found
 * the single most relevant page (a real production case: OFFICIAL_LEGAL
 * found the exact target GOV.UK guidance page, but all 3 slots went to
 * OFFICIAL_PRIMARY's weaker Parliament-petition results instead, purely
 * because of pooling order).
 *
 * Deterministic "coverage before depth" strategy — no relevance AI, no
 * embeddings, no domain-authority scoring beyond what isPrimarySourceUrl
 * already does:
 * 1. Best (specific-page-first, then lowest rank) valid candidate from
 *    OFFICIAL_LEGAL — Home Office guidance / Immigration Rules / statutory
 *    material is worth the first extraction opportunity in a Research
 *    pipeline, for every topic, not just this one case.
 * 2. Best valid candidate from OFFICIAL_PRIMARY.
 * 3. Any remaining slots: next-best remaining candidates from
 *    OFFICIAL_LEGAL + OFFICIAL_PRIMARY combined.
 * 4. Only if OFFICIAL_LEGAL + OFFICIAL_PRIMARY together can't fill every
 *    slot: fall back to GENERAL's own primary-source results (never its
 *    commercial/secondary ones — isPrimarySourceUrl already excludes those).
 *
 * Homepage demotion and cross-lane URL dedupe both still apply.
 */
export function selectOfficialExtractionTargets<T extends { url: string }>(
  hits: readonly LanedSearchHit<T>[],
  max: number = MAX_OFFICIAL_EXTRACTS,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];

  function take(hit: LanedSearchHit<T>) {
    seen.add(hit.result.url);
    selected.push(hit.result);
  }

  function bestCandidate(lanes: readonly ResearchSearchLane[]): LanedSearchHit<T> | null {
    const candidates = hits.filter(
      (h) => lanes.includes(h.lane) && isPrimarySourceUrl(h.result.url) && !seen.has(h.result.url),
    );
    if (candidates.length === 0) return null;
    return [...candidates].sort((a, b) => {
      const homepageScoreA = isBareHomepage(a.result.url) ? 0 : 1;
      const homepageScoreB = isBareHomepage(b.result.url) ? 0 : 1;
      if (homepageScoreA !== homepageScoreB) return homepageScoreB - homepageScoreA;
      return a.rankWithinQuery - b.rankWithinQuery;
    })[0];
  }

  const legalBest = bestCandidate(["OFFICIAL_LEGAL"]);
  if (legalBest && selected.length < max) take(legalBest);

  const primaryBest = bestCandidate(["OFFICIAL_PRIMARY"]);
  if (primaryBest && selected.length < max) take(primaryBest);

  let next = bestCandidate(["OFFICIAL_LEGAL", "OFFICIAL_PRIMARY"]);
  while (next && selected.length < max) {
    take(next);
    next = bestCandidate(["OFFICIAL_LEGAL", "OFFICIAL_PRIMARY"]);
  }

  let generalNext = bestCandidate(["GENERAL"]);
  while (generalNext && selected.length < max) {
    take(generalNext);
    generalNext = bestCandidate(["GENERAL"]);
  }

  return selected;
}

/**
 * The query passed to Tavily Extract's query-focused chunk reranking
 * (Round 4) — derived the same way buildResearchQueries derives its base
 * query, from real topic context only. Never hard-codes topic-specific
 * terms (e.g. "returning resident", "lapse of ILR") — those must come
 * from the actual topic being researched, not a fixed template for one
 * scenario.
 */
export function buildExtractionQuery(topic: { title: string; question: string; business: string }): string {
  const base = (topic.question || topic.title).trim();
  return topic.business ? `${base} ${topic.business}`.trim() : base;
}

/**
 * A bare domain root (`https://www.gov.uk/`, or no path at all) — generic
 * detection, not a hard-coded list of "homepage" URLs for any specific
 * topic. See selectOfficialExtractionTargets / rankSearchResults.
 */
function isBareHomepage(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    return pathname === "/" || pathname === "";
  } catch {
    return false;
  }
}

/**
 * Round 4B: 2 (primary, specific page) > 1 (primary, bare homepage) > 0
 * (secondary). A bare official homepage (e.g. `https://www.gov.uk/`)
 * still counts as primary — it's kept, not discarded, for when no more
 * specific official page was found — but a real production run showed a
 * search occasionally surfacing only the bare domain root rather than the
 * actual relevant page; when a more specific official page IS also
 * present, it must rank ahead of the homepage.
 */
function rankScore(url: string): number {
  if (!isPrimarySourceUrl(url)) return 0;
  return isBareHomepage(url) ? 1 : 2;
}

/**
 * Boosts primary-source results to the front without discarding secondary
 * sources — they may still help discovery (spec: "do not automatically
 * discard all secondary sources"). Within the primary group, a specific
 * page outranks a bare homepage (Round 4B — see rankScore). Stable sort:
 * relative order within each of the three groups is preserved.
 */
export function rankSearchResults<T extends { url: string }>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => rankScore(b.url) - rankScore(a.url));
}
