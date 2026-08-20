import { describe, expect, it } from "vitest";
import {
  ExternalResearchClaimSchema,
  buildExternalGroundedPack,
  buildSearchResultManifest,
} from "./research-external";
import type { SearchResult } from "../search/types";

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
});

describe("buildExternalGroundedPack", () => {
  it("resolves a cited label back to the real search result", () => {
    const results = [makeResult({ url: "https://www.gov.uk/real", title: "Real GOV.UK page", snippet: "real snippet" })];
    const { labelToResult } = buildSearchResultManifest(results);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: ["f"], source_references: ["S1"], warnings: "", confidence: "HIGH" },
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
      { summary: "s", key_findings: ["f"], source_references: ["S1", "S99"], warnings: "", confidence: "MEDIUM" },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(1);
    expect(pack.sources.some((s) => s.url === "https://www.gov.uk/only")).toBe(true);
    expect(pack.warnings).toMatch(/自动移除 1 条/);
  });

  it("never resolves an invented label into a fabricated source even when nothing real was cited", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: ["S1"], warnings: "", confidence: "LOW" },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(0);
  });

  it("always discloses the snippet-only limitation regardless of confidence", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: [], warnings: "", confidence: "HIGH" },
      labelToResult,
    );
    expect(pack.warnings).toMatch(/未完整阅读原始网页全文/);
  });

  it("preserves the model's own uncertainty notes in warnings", () => {
    const { labelToResult } = buildSearchResultManifest([]);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: [], warnings: "规则可能已更新，建议人工核实。", confidence: "LOW" },
      labelToResult,
    );
    expect(pack.warnings).toContain("规则可能已更新，建议人工核实。");
  });

  it("deduplicates repeated citations of the same source", () => {
    const results = [makeResult({ url: "https://www.gov.uk/dup" })];
    const { labelToResult } = buildSearchResultManifest(results);
    const pack = buildExternalGroundedPack(
      { summary: "s", key_findings: [], source_references: ["S1", "S1"], warnings: "", confidence: "HIGH" },
      labelToResult,
    );
    expect(pack.sources).toHaveLength(1);
  });
});
