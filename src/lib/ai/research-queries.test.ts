import { describe, expect, it } from "vitest";
import {
  buildExtractionQuery,
  buildOptimizationSearchQueries,
  buildResearchSearchQueries,
  dedupeSearchResultsByUrl,
  isPrimarySourceUrl,
  rankSearchResults,
  selectOfficialExtractionTargets,
  tagSearchHitsByLane,
  MAX_OFFICIAL_EXTRACTS,
  PRIMARY_SOURCE_DOMAINS,
} from "./research-queries";
import type { LanedSearchHit } from "./research-queries";
import type { ResearchSearchLane } from "../search/types";
import type { ResearchScoreBreakdown } from "../types";

const TOPIC = {
  title: "老永居离境超过2年，身份还在吗？",
  question: "老永居离境超过2年，身份还在吗？",
  business: "永居 / ILR",
  audience: "持老式永居（ILR）并长期离境的申请人",
};

// Round 4B — official-first Research Search: express "official domain"
// through the Search Provider's own domain filtering instead of a text
// suffix, since a real production run showed "<question> gov.uk" just
// matching the bare domain string rather than a relevant page.
describe("buildResearchSearchQueries", () => {
  // TEST 4
  it("derives at most 3 search queries, never hard-coding an answer", () => {
    const queries = buildResearchSearchQueries(TOPIC);
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  // TEST 1
  it("Query 1 (official primary search): the real question, restricted to PRIMARY_SOURCE_DOMAINS via includeDomains", () => {
    const [q1] = buildResearchSearchQueries(TOPIC);
    expect(q1.query).toBe("老永居离境超过2年，身份还在吗？");
    expect(q1.includeDomains).toEqual(PRIMARY_SOURCE_DOMAINS);
  });

  // TEST 2
  it('does not append "gov.uk" (or any domain name) as a text suffix anywhere', () => {
    const queries = buildResearchSearchQueries(TOPIC);
    for (const q of queries) {
      expect(q.query).not.toContain("gov.uk");
      expect(q.query).not.toMatch(/\bHome Office guidance\b.*gov\.uk/);
    }
  });

  it("Query 2 (official legal/guidance search): a light legal-intent phrasing, also official-domains-only", () => {
    const queries = buildResearchSearchQueries(TOPIC);
    const guidanceQuery = queries.find((q) => q.query.includes("Immigration Rules"));
    expect(guidanceQuery).toBeDefined();
    expect(guidanceQuery?.includeDomains).toEqual(PRIMARY_SOURCE_DOMAINS);
    expect(guidanceQuery?.query).toContain("永居 / ILR");
  });

  // TEST 3
  it("Query 3 (general secondary search): the same question, no includeDomains at all", () => {
    const queries = buildResearchSearchQueries(TOPIC);
    const secondary = queries.filter((q) => q.includeDomains === undefined);
    expect(secondary.length).toBeGreaterThanOrEqual(1);
    expect(secondary[0].query).toBe("老永居离境超过2年，身份还在吗？");
  });

  it("de-duplicates identical {query, includeDomains} pairs", () => {
    const topic = { title: "x", question: "x", business: "", audience: "" };
    const queries = buildResearchSearchQueries(topic);
    const keys = queries.map((q) => `${q.query}|${(q.includeDomains ?? []).join(",")}`);
    expect(new Set(keys).size).toBe(queries.length);
  });

  it("falls back to title when question is empty", () => {
    const queries = buildResearchSearchQueries({ title: "标题内容", question: "", business: "", audience: "" });
    expect(queries.some((q) => q.query.includes("标题内容"))).toBe(true);
  });

  it("never hard-codes a topic-specific term regardless of what topic is passed", () => {
    const queries = buildResearchSearchQueries({
      title: "每两年回英国一次，永居就一定不会出问题吗？",
      question: "长期住在海外的英国永居持有人，短期回英国探亲或处理房产，是否足以避免日后回英定居的身份风险？",
      business: "永居 / ILR / Returning Resident",
      audience: "长期居住海外、持有英国永居的人",
    });
    const combined = queries.map((q) => q.query.toLowerCase()).join(" ");
    expect(combined).not.toContain("lapse of ilr");
    expect(combined).not.toContain("continuous absence");
    expect(combined).not.toContain("permitted period");
  });
});

describe("dedupeSearchResultsByUrl", () => {
  // TEST 5
  it("keeps only the first occurrence of a URL returned by multiple queries (e.g. official + guidance search)", () => {
    const results = [
      { url: "https://www.gov.uk/returning-resident-visa", from: "official-search" },
      { url: "https://www.gov.uk/returning-resident-visa", from: "guidance-search" },
      { url: "https://commercial.example.com/x", from: "general-search" },
    ];
    const deduped = dedupeSearchResultsByUrl(results);
    expect(deduped).toHaveLength(2);
    expect(deduped.find((r) => r.url === "https://www.gov.uk/returning-resident-visa")?.from).toBe("official-search");
  });

  it("leaves an already-unique list untouched", () => {
    const results = [{ url: "https://a.com" }, { url: "https://b.com" }];
    expect(dedupeSearchResultsByUrl(results)).toEqual(results);
  });
});

describe("isPrimarySourceUrl", () => {
  it("recognizes gov.uk and its subdomains as primary", () => {
    expect(isPrimarySourceUrl("https://www.gov.uk/example")).toBe(true);
    expect(isPrimarySourceUrl("https://assets.publishing.service.gov.uk/x")).toBe(true);
  });

  it("recognizes legislation.gov.uk, parliament.uk, and the IAA domain as primary", () => {
    expect(isPrimarySourceUrl("https://www.legislation.gov.uk/x")).toBe(true);
    expect(isPrimarySourceUrl("https://www.parliament.uk/x")).toBe(true);
    expect(isPrimarySourceUrl("https://www.immigrationadviceauthority.gov.uk/x")).toBe(true);
  });

  it("does not treat unrelated domains as primary", () => {
    expect(isPrimarySourceUrl("https://www.reddit.com/r/ukvisa")).toBe(false);
    expect(isPrimarySourceUrl("https://somelawfirm.example.com/blog")).toBe(false);
  });

  it("does not throw on a malformed URL", () => {
    expect(isPrimarySourceUrl("not a url")).toBe(false);
  });
});

describe("rankSearchResults", () => {
  it("boosts primary-source results to the front without discarding secondary sources", () => {
    const results = [
      { url: "https://blog.example.com/a", label: "secondary-1" },
      { url: "https://www.gov.uk/b", label: "primary-1" },
      { url: "https://forum.example.com/c", label: "secondary-2" },
      { url: "https://www.legislation.gov.uk/d", label: "primary-2" },
    ];
    const ranked = rankSearchResults(results);
    expect(ranked).toHaveLength(4);
    expect(ranked[0].label).toBe("primary-1");
    expect(ranked[1].label).toBe("primary-2");
    // secondary sources are preserved, not discarded
    expect(ranked.map((r) => r.label)).toEqual(
      expect.arrayContaining(["secondary-1", "secondary-2"]),
    );
  });

  it("preserves relative order within the primary and secondary groups (stable sort)", () => {
    const results = [
      { url: "https://www.gov.uk/1", label: "p1" },
      { url: "https://www.gov.uk/2", label: "p2" },
    ];
    const ranked = rankSearchResults(results);
    expect(ranked.map((r) => r.label)).toEqual(["p1", "p2"]);
  });

  // TEST 6 — Round 4B: a bare official homepage must not outrank a
  // specific page on the same (or another) official domain, generically
  // (path === "/" or empty), never hard-coded to one topic's URL.
  it("demotes a bare official homepage below a more specific official page", () => {
    const results = [
      { url: "https://www.gov.uk/", label: "homepage" },
      { url: "https://www.gov.uk/returning-resident-visa", label: "specific-page" },
    ];
    const ranked = rankSearchResults(results);
    expect(ranked.map((r) => r.label)).toEqual(["specific-page", "homepage"]);
  });

  it("still keeps a bare official homepage (not discarded) when no more specific official page exists", () => {
    const results = [
      { url: "https://www.gov.uk/", label: "homepage" },
      { url: "https://commercial.example.com/x", label: "secondary" },
    ];
    const ranked = rankSearchResults(results);
    expect(ranked.map((r) => r.label)).toEqual(["homepage", "secondary"]);
  });

  it("treats a URL with no path at all the same as a trailing-slash root", () => {
    const results = [
      { url: "https://www.legislation.gov.uk", label: "homepage-no-slash" },
      { url: "https://www.legislation.gov.uk/ukpga/2026/1", label: "specific-page" },
    ];
    const ranked = rankSearchResults(results);
    expect(ranked.map((r) => r.label)).toEqual(["specific-page", "homepage-no-slash"]);
  });
});

// Round 4D — query-aware official extraction selection: which few
// results are worth a real page-content fetch, chosen by LANE coverage
// (OFFICIAL_LEGAL / OFFICIAL_PRIMARY / GENERAL) instead of whichever
// query happened to be pooled first.
function hit<T extends { url: string }>(result: T, lane: ResearchSearchLane, rankWithinQuery: number): LanedSearchHit<T> {
  return { result, lane, rankWithinQuery };
}

describe("tagSearchHitsByLane", () => {
  it("zips each execution's results with the lane of the query at the same index, preserving within-query rank", () => {
    const executions = [
      { results: [{ url: "https://www.gov.uk/a" }, { url: "https://www.gov.uk/b" }] },
      { results: [{ url: "https://www.gov.uk/c" }] },
    ];
    const queries = [
      { query: "q1", lane: "OFFICIAL_PRIMARY" as const },
      { query: "q2", lane: "OFFICIAL_LEGAL" as const },
    ];
    const hits = tagSearchHitsByLane(executions, queries);
    expect(hits).toEqual([
      { result: { url: "https://www.gov.uk/a" }, lane: "OFFICIAL_PRIMARY", rankWithinQuery: 0 },
      { result: { url: "https://www.gov.uk/b" }, lane: "OFFICIAL_PRIMARY", rankWithinQuery: 1 },
      { result: { url: "https://www.gov.uk/c" }, lane: "OFFICIAL_LEGAL", rankWithinQuery: 0 },
    ]);
  });

  it("defaults to GENERAL when a query carries no lane (e.g. Topic Discovery's plain strings)", () => {
    const executions = [{ results: [{ url: "https://a.com" }] }];
    const queries = [{ query: "q1" }];
    expect(tagSearchHitsByLane(executions, queries)[0].lane).toBe("GENERAL");
  });
});

describe("selectOfficialExtractionTargets", () => {
  // TEST 1 — exact production regression: OFFICIAL_LEGAL must not be starved
  // by OFFICIAL_PRIMARY just because it was pooled first.
  it("TEST 1: includes OFFICIAL_LEGAL's best result even when OFFICIAL_PRIMARY has 3 valid candidates of its own", () => {
    const hits = [
      hit({ url: "https://petition.parliament.uk/p1", label: "P1" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://petition.parliament.uk/p2", label: "P2" }, "OFFICIAL_PRIMARY", 1),
      hit({ url: "https://petition.parliament.uk/p3", label: "P3" }, "OFFICIAL_PRIMARY", 2),
      hit({ url: "https://www.gov.uk/government/publications/returning-residents/lapsing-leave-and-returning-residents-accessible", label: "L1" }, "OFFICIAL_LEGAL", 0),
      hit({ url: "https://www.gov.uk/other-guidance", label: "L2" }, "OFFICIAL_LEGAL", 1),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected.map((r) => r.label)).toContain("L1");
  });

  // TEST 2 — lane coverage
  it("TEST 2: selects at least one from each lane when both have valid candidates and max >= 2", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/primary", label: "primary" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/legal", label: "legal" }, "OFFICIAL_LEGAL", 0),
    ];
    const selected = selectOfficialExtractionTargets(hits, 2);
    expect(selected.map((r) => r.label).sort()).toEqual(["legal", "primary"]);
  });

  // TEST 3 — legal lane goes first
  it("TEST 3: the first selected target comes from OFFICIAL_LEGAL when it has a valid result", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/primary", label: "primary" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/legal", label: "legal" }, "OFFICIAL_LEGAL", 0),
    ];
    expect(selectOfficialExtractionTargets(hits)[0].label).toBe("legal");
  });

  // TEST 4 — cross-lane dedupe
  it("TEST 4: the same URL appearing in both OFFICIAL_PRIMARY and OFFICIAL_LEGAL is only selected once", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/same", label: "from-primary" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/same", label: "from-legal" }, "OFFICIAL_LEGAL", 0),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected).toHaveLength(1);
  });

  // TEST 5 — fill remaining slot from whichever lane has more
  it("TEST 5: fills the third slot from OFFICIAL_PRIMARY's next-best when legal only has one", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/legal-1", label: "legal1" }, "OFFICIAL_LEGAL", 0),
      hit({ url: "https://www.gov.uk/primary-1", label: "primary1" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/primary-2", label: "primary2" }, "OFFICIAL_PRIMARY", 1),
      hit({ url: "https://www.gov.uk/primary-3", label: "primary3" }, "OFFICIAL_PRIMARY", 2),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected.map((r) => r.label)).toEqual(["legal1", "primary1", "primary2"]);
  });

  // TEST 6 — legal-only fallback
  it("TEST 6: uses all 3 from OFFICIAL_LEGAL when OFFICIAL_PRIMARY has no valid candidates", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/legal-1", label: "legal1" }, "OFFICIAL_LEGAL", 0),
      hit({ url: "https://www.gov.uk/legal-2", label: "legal2" }, "OFFICIAL_LEGAL", 1),
      hit({ url: "https://www.gov.uk/legal-3", label: "legal3" }, "OFFICIAL_LEGAL", 2),
      hit({ url: "https://commercial.example.com/x", label: "commercial-primary" }, "OFFICIAL_PRIMARY", 0),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected.map((r) => r.label)).toEqual(["legal1", "legal2", "legal3"]);
  });

  // TEST 7 — primary-only fallback
  it("TEST 7: uses all 3 from OFFICIAL_PRIMARY when OFFICIAL_LEGAL has no valid candidates", () => {
    const hits = [
      hit({ url: "https://commercial.example.com/x", label: "commercial-legal" }, "OFFICIAL_LEGAL", 0),
      hit({ url: "https://www.gov.uk/primary-1", label: "primary1" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/primary-2", label: "primary2" }, "OFFICIAL_PRIMARY", 1),
      hit({ url: "https://www.gov.uk/primary-3", label: "primary3" }, "OFFICIAL_PRIMARY", 2),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected.map((r) => r.label)).toEqual(["primary1", "primary2", "primary3"]);
  });

  // TEST 8 — GENERAL fills a remaining slot only with a real primary-source URL
  it("TEST 8: falls back to a primary-source result found in GENERAL only when OFFICIAL_PRIMARY + OFFICIAL_LEGAL can't fill every slot", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/primary-1", label: "primary1" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/legal-1", label: "legal1" }, "OFFICIAL_LEGAL", 0),
      hit({ url: "https://www.legislation.gov.uk/specific-page", label: "general-official" }, "GENERAL", 0),
      hit({ url: "https://some-commercial-site.com/x", label: "general-commercial" }, "GENERAL", 1),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected.map((r) => r.label)).toContain("general-official");
    expect(selected).toHaveLength(3);
  });

  // TEST 9 — commercial GENERAL results are never extraction candidates
  it("TEST 9: never selects a commercial/non-primary-source URL from GENERAL, even to fill an empty slot", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/primary-1", label: "primary1" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://commercial-law-firm.com/page", label: "commercial" }, "GENERAL", 0),
    ];
    const selected = selectOfficialExtractionTargets(hits);
    expect(selected.map((r) => r.label)).not.toContain("commercial");
  });

  // TEST 10 — homepage demotion still applies within a single lane
  it("TEST 10: prefers a specific page over a bare homepage within the same lane", () => {
    const hits = [
      hit({ url: "https://www.gov.uk/", label: "homepage" }, "OFFICIAL_PRIMARY", 0),
      hit({ url: "https://www.gov.uk/specific-guidance", label: "specific" }, "OFFICIAL_PRIMARY", 1),
    ];
    expect(selectOfficialExtractionTargets(hits, 1)[0].label).toBe("specific");
  });

  // TEST 11 — max cap always holds
  it("TEST 11: never returns more than max regardless of how many valid candidates exist across all lanes", () => {
    const hits = [
      ...Array.from({ length: 3 }, (_, i) => hit({ url: `https://www.gov.uk/legal-${i}`, label: `legal${i}` }, "OFFICIAL_LEGAL", i)),
      ...Array.from({ length: 3 }, (_, i) => hit({ url: `https://www.gov.uk/primary-${i}`, label: `primary${i}` }, "OFFICIAL_PRIMARY", i)),
      ...Array.from({ length: 3 }, (_, i) => hit({ url: `https://www.legislation.gov.uk/general-${i}`, label: `general${i}` }, "GENERAL", i)),
    ];
    expect(selectOfficialExtractionTargets(hits, 3)).toHaveLength(3);
    expect(selectOfficialExtractionTargets(hits)).toHaveLength(MAX_OFFICIAL_EXTRACTS); // default max
  });

  it("returns an empty array when nothing official is present in any lane", () => {
    const hits = [hit({ url: "https://commercial.com/x", label: "commercial" }, "GENERAL", 0)];
    expect(selectOfficialExtractionTargets(hits)).toEqual([]);
  });
});

describe("buildExtractionQuery", () => {
  it("derives the extraction query from real topic context, not a hard-coded template", () => {
    const query = buildExtractionQuery({
      title: "每两年回英国一次，永居就一定不会出问题吗？",
      question: "长期住在海外的英国永居持有人，短期回英国探亲或处理房产，是否足以避免日后回英定居的身份风险？",
      business: "永居 / ILR / Returning Resident",
    });
    expect(query).toContain("长期住在海外的英国永居持有人");
    expect(query).toContain("永居 / ILR / Returning Resident");
    // must not hard-code returning-resident-specific terms independent of topic input
    expect(query.toLowerCase()).not.toContain("lapse of ilr");
    expect(query.toLowerCase()).not.toContain("permitted period");
  });

  it("falls back to title when question is empty, same as buildResearchQueries", () => {
    const query = buildExtractionQuery({ title: "标题内容", question: "", business: "" });
    expect(query).toContain("标题内容");
  });
});

const HEALTHY = { score: 20, max: 20, reason: "ok" };
function fullBreakdown(overrides: Partial<ResearchScoreBreakdown>): ResearchScoreBreakdown {
  return {
    officialSources: HEALTHY,
    factAccuracy: HEALTHY,
    policyTimeline: HEALTHY,
    scopeExceptions: { score: 15, max: 15, reason: "ok" },
    dataReliability: { score: 10, max: 10, reason: "ok" },
    externalSafety: { score: 15, max: 15, reason: "ok" },
    ...overrides,
  };
}

/**
 * Research Optimization's queries must be targeted at whatever actually
 * scored low last time, not a repeat of the same fixed 3-query cold-start
 * template (which would just reproduce the same evidence gap). See §六 of
 * the 研究优化 spec.
 */
describe("buildOptimizationSearchQueries", () => {
  it("generates nothing when every dimension is already healthy — no query budget wasted on what isn't broken", () => {
    const queries = buildOptimizationSearchQueries(TOPIC, fullBreakdown({}));
    expect(queries).toEqual([]);
  });

  it("generates official-domain-restricted queries when official_sources scored low", () => {
    const breakdown = fullBreakdown({ officialSources: { score: 5, max: 20, reason: "官方来源不足" } });
    const queries = buildOptimizationSearchQueries(TOPIC, breakdown);
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.includeDomains).toEqual(PRIMARY_SOURCE_DOMAINS);
    }
  });

  it("generates timeline-focused queries when policy_timeline scored low", () => {
    const breakdown = fullBreakdown({ policyTimeline: { score: 8, max: 20, reason: "时间线不明确" } });
    const queries = buildOptimizationSearchQueries(TOPIC, breakdown);
    const combined = queries.map((q) => q.query.toLowerCase()).join(" | ");
    expect(combined).toMatch(/transitional arrangements|implementation date|commencement/);
  });

  it("generates scope/exception-focused queries when scope_exceptions scored low", () => {
    const breakdown = fullBreakdown({ scopeExceptions: { score: 5, max: 15, reason: "适用范围不明确" } });
    const queries = buildOptimizationSearchQueries(TOPIC, breakdown);
    const combined = queries.map((q) => q.query.toLowerCase()).join(" | ");
    expect(combined).toMatch(/existing visa holders|grandfathering|exceptions/);
  });

  it("never generates a query fix for fact_accuracy/data_reliability/external_safety — those aren't solved by searching more", () => {
    const breakdown = fullBreakdown({
      factAccuracy: { score: 2, max: 20, reason: "low" },
      dataReliability: { score: 1, max: 10, reason: "low" },
      externalSafety: { score: 1, max: 15, reason: "low" },
    });
    expect(buildOptimizationSearchQueries(TOPIC, breakdown)).toEqual([]);
  });

  it("caps the total at 6 queries even when every fixable dimension is low", () => {
    const breakdown = fullBreakdown({
      officialSources: { score: 2, max: 20, reason: "low" },
      policyTimeline: { score: 2, max: 20, reason: "low" },
      scopeExceptions: { score: 2, max: 15, reason: "low" },
    });
    const queries = buildOptimizationSearchQueries(TOPIC, breakdown);
    expect(queries.length).toBeLessThanOrEqual(6);
  });

  it("returns nothing when the topic has neither a question nor a title to search from", () => {
    const breakdown = fullBreakdown({ officialSources: { score: 0, max: 20, reason: "low" } });
    const queries = buildOptimizationSearchQueries({ title: "", question: "", business: "b", audience: "a" }, breakdown);
    expect(queries).toEqual([]);
  });
});
