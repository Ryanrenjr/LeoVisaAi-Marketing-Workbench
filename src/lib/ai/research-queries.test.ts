import { describe, expect, it } from "vitest";
import { buildResearchQueries, isPrimarySourceUrl, rankSearchResults } from "./research-queries";

const TOPIC = {
  title: "老永居离境超过2年，身份还在吗？",
  question: "老永居离境超过2年，身份还在吗？",
  business: "永居 / ILR",
  audience: "持老式永居（ILR）并长期离境的申请人",
};

describe("buildResearchQueries", () => {
  it("derives at most 3 queries from topic context (development budget), never hard-coding an answer", () => {
    const queries = buildResearchQueries(TOPIC);
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries.length).toBeLessThanOrEqual(3);
    for (const q of queries) expect(q).toContain("老永居离境超过2年，身份还在吗？");
  });

  it("incorporates business and audience context into the queries", () => {
    const queries = buildResearchQueries(TOPIC);
    expect(queries.some((q) => q.includes("永居 / ILR"))).toBe(true);
    expect(queries.some((q) => q.includes("持老式永居（ILR）并长期离境的申请人"))).toBe(true);
  });

  it("de-duplicates identical generated queries", () => {
    const topic = { title: "x", question: "x", business: "", audience: "" };
    const queries = buildResearchQueries(topic);
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("falls back to title when question is empty", () => {
    const queries = buildResearchQueries({ title: "标题内容", question: "", business: "", audience: "" });
    expect(queries.some((q) => q.includes("标题内容"))).toBe(true);
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
});
