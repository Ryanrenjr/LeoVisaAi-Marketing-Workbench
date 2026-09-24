import { describe, expect, it } from "vitest";
import {
  EXTERNAL_RESEARCH_SYSTEM_PROMPT,
  ExternalResearchClaimSchema,
  buildExternalGroundedPack,
  buildSearchResultManifest,
} from "./research-external";
import type { SearchResult } from "../search/types";

const SAMPLE_SCORES = {
  official_sources: { score: 18, reason: "r" },
  fact_accuracy: { score: 18, reason: "r" },
  policy_timeline: { score: 18, reason: "r" },
  scope_exceptions: { score: 13, reason: "r" },
  data_reliability: { score: 9, reason: "r" },
  external_safety: { score: 13, reason: "r" },
};

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "GOV.UK — ILR guidance",
    url: "https://www.gov.uk/ilr-guidance",
    snippet: "Official summary of ILR absence rules.",
    publisher: "gov.uk",
    publishedDate: "3 months ago",
    pageAge: "3 months ago",
    retrievedAt: "2026-08-20T00:00:00.000Z",
    provider: "BRAVE",
    ...overrides,
  };
}

describe("ExternalResearchClaimSchema", () => {
  it("accepts a well-formed claim", () => {
    const parsed = ExternalResearchClaimSchema.safeParse({
      summary: "s",
      key_findings: ["f1"],
      source_references: ["S1"],
      warnings: "",
      confidence: "HIGH",
      scores: SAMPLE_SCORES,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a claim missing source_references", () => {
    const parsed = ExternalResearchClaimSchema.safeParse({
      summary: "s",
      key_findings: [],
      warnings: "",
      confidence: "HIGH",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("buildSearchResultManifest", () => {
  it("labels results S1, S2, ... and builds a resolvable map", () => {
    const results = [makeResult({ url: "https://www.gov.uk/a" }), makeResult({ url: "https://www.gov.uk/b" })];
    const { entries, labelToResult, manifestText } = buildSearchResultManifest(results);
    expect(entries.map((e) => e.label)).toEqual(["S1", "S2"]);
    expect(labelToResult.get("S1")?.url).toBe("https://www.gov.uk/a");
    expect(manifestText).toContain("[S1]");
    expect(manifestText).toContain("https://www.gov.uk/a");
  });

  it("produces an explicit empty-manifest notice when there are no results", () => {
    const { manifestText, entries } = buildSearchResultManifest([]);
    expect(entries).toHaveLength(0);
    expect(manifestText).toMatch(/没有返回可用结果/);
  });

  // Round 4 — official source extraction: TEST 4 + TEST 5
  it("TEST 4/5: includes real extracted page content (not just the snippet) and marks it OFFICIAL_EXTRACT when a URL has been extracted", () => {
    const results = [
      makeResult({ url: "https://www.gov.uk/a", snippet: "short search snippet" }),
      makeResult({ url: "https://commercial.example.com/b", snippet: "commercial site snippet" }),
    ];
    const extractedByUrl = new Map([["https://www.gov.uk/a", "This is the REAL extracted page content from GOV.UK, much longer than a snippet."]]);
    const { entries, manifestText } = buildSearchResultManifest(results, extractedByUrl);

    expect(entries[0].evidenceType).toBe("OFFICIAL_EXTRACT");
    expect(entries[0].extractedContent).toContain("REAL extracted page content");
    expect(entries[1].evidenceType).toBe("SEARCH_SNIPPET");
    expect(entries[1].extractedContent).toBeNull();

    expect(manifestText).toContain("This is the REAL extracted page content from GOV.UK");
    expect(manifestText).toContain("Evidence type: OFFICIAL_EXTRACT");
    expect(manifestText).toContain("Evidence type: SEARCH_SNIPPET");
    expect(manifestText).toContain("commercial site snippet");
  });

  it("a result whose URL isn't in extractedByUrl stays SEARCH_SNIPPET, never silently upgraded", () => {
    const results = [makeResult({ url: "https://www.gov.uk/not-extracted" })];
    const extractedByUrl = new Map([["https://www.gov.uk/some-other-url", "content for a different url"]]);
    const { entries } = buildSearchResultManifest(results, extractedByUrl);
    expect(entries[0].evidenceType).toBe("SEARCH_SNIPPET");
  });
});

describe("EXTERNAL_RESEARCH_SYSTEM_PROMPT", () => {
  // TEST 7
  it("no longer unconditionally claims the model has not read any official page text", () => {
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).not.toContain("You have not read any complete official document");
  });

  it("still tells the model OFFICIAL_EXTRACT may be treated as read, but only what is actually shown", () => {
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("OFFICIAL_EXTRACT");
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("You may treat this as read and reason from it directly");
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("only about what is actually shown");
  });

  it("still warns SEARCH_SNIPPET is not the full page", () => {
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("SEARCH_SNIPPET");
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("don't treat it as the full page");
  });

  it("states an evidence hierarchy where official extracts outrank commercial/secondary sources", () => {
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("Evidence hierarchy");
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain(
      "do not let a commercial immigration website's explanation override or dilute what an official extract directly shows",
    );
  });

  it("bases confidence on evidence level rather than mechanically capping it", () => {
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("can justify HIGH confidence even with few secondary sources");
    expect(EXTERNAL_RESEARCH_SYSTEM_PROMPT).toContain("Do not mechanically cap confidence at MEDIUM/LOW out of habit");
  });
});

describe("buildExternalGroundedPack", () => {
  it("resolves a cited label back to the real search result", () => {
    const results = [makeResult({ url: "https://www.gov.uk/real", title: "Real GOV.UK page", snippet: "real snippet" })];
    const { labelToResult } = buildSearchResultManifest(results);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: ["f"], source_references: ["S1"], warnings: "", confidence: "HIGH", scores: SAMPLE_SCORES },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(1);
    expect(pack.sources[0].url).toBe("https://www.gov.uk/real");
    expect(pack.sources[0].title).toBe("Real GOV.UK page");
  });

  it("drops an invented source label — S99 when only S1 exists — rather than fabricating a source", () => {
    const results = [makeResult({ url: "https://www.gov.uk/only" })];
    const { labelToResult } = buildSearchResultManifest(results);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: ["f"], source_references: ["S1", "S99"], warnings: "", confidence: "MEDIUM", scores: SAMPLE_SCORES },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(1);
    expect(pack.sources.some((s) => s.url === "https://www.gov.uk/only")).toBe(true);
    expect(pack.warnings).toMatch(/自动移除 1 条/);
  });

  it("never resolves an invented label into a fabricated source even when nothing real was cited", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: ["S1"], warnings: "", confidence: "LOW", scores: SAMPLE_SCORES },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(0);
  });

  it("discloses snippet-only retrieval when no official extraction happened, regardless of confidence", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "HIGH", scores: SAMPLE_SCORES },
      labelToResult,
    );
    expect(pack.warnings).toMatch(/未读取官方页面正文/);
  });

  it("preserves the model's own uncertainty notes in warnings", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: [], warnings: "规则可能已更新，建议人工核实。", confidence: "LOW", scores: SAMPLE_SCORES },
      labelToResult,
    );
    expect(pack.warnings).toContain("规则可能已更新，建议人工核实。");
  });

  it("deduplicates repeated citations of the same source", () => {
    const results = [makeResult({ url: "https://www.gov.uk/dup" })];
    const { labelToResult } = buildSearchResultManifest(results);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: ["S1", "S1"], warnings: "", confidence: "HIGH", scores: SAMPLE_SCORES },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(1);
  });

  // TEST 8 — warning honesty
  it("when official extraction succeeded, does not claim the research is snippet-title-only", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "HIGH", scores: SAMPLE_SCORES },
      labelToResult,
      { officialExtractCount: 2, failedExtractionCount: 0 },
    );
    expect(pack.warnings).not.toContain("本次研究仅基于搜索结果标题与摘要");
    expect(pack.warnings).toContain("已读取 2 个官方来源");
  });

  it("notes when an official extraction attempt failed, without failing the pack", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "MEDIUM", scores: SAMPLE_SCORES },
      labelToResult,
      { officialExtractCount: 1, failedExtractionCount: 1 },
    );
    expect(pack.warnings).toContain("已读取 1 个官方来源");
    expect(pack.warnings).toContain("1 个官方来源尝试读取正文失败");
  });

  // TEST 9 — grounding still holds with the new manifest/evidence-type shape
  it("still drops a hallucinated label (S99) even when real entries are OFFICIAL_EXTRACT", () => {
    const results = [makeResult({ url: "https://www.gov.uk/real" })];
    const extractedByUrl = new Map([["https://www.gov.uk/real", "real extracted content"]]);
    const { labelToResult } = buildSearchResultManifest(results, extractedByUrl);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: ["f"], source_references: ["S1", "S99"], warnings: "", confidence: "HIGH", scores: SAMPLE_SCORES },
      labelToResult,
      { officialExtractCount: 1, failedExtractionCount: 0 },
    );
    expect(pack.sources).toHaveLength(1);
    expect(pack.warnings).toMatch(/自动移除 1 条/);
  });

  // TEST 10 — no DB bloat
  it("never stores the full extracted page content in GroundedSource.note — only the short snippet", () => {
    const longExtractedContent = "X".repeat(5000);
    const results = [makeResult({ url: "https://www.gov.uk/real", snippet: "short snippet only" })];
    const extractedByUrl = new Map([["https://www.gov.uk/real", longExtractedContent]]);
    const { labelToResult } = buildSearchResultManifest(results, extractedByUrl);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: ["f"], source_references: ["S1"], warnings: "", confidence: "HIGH", scores: SAMPLE_SCORES },
      labelToResult,
      { officialExtractCount: 1, failedExtractionCount: 0 },
    );
    expect(pack.sources[0].note).toBe("short snippet only");
    expect(pack.sources[0].note).not.toContain("XXXX");
    expect(pack.sources[0].note.length).toBeLessThan(100);
  });
});
