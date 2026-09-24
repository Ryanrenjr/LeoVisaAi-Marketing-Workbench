import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT,
  ResearchQueryPlanSchema,
  buildResearchQueryPlannerUserPrompt,
  cleanResearchQueryPlan,
  planToResearchSearchQueries,
} from "./research-query-planner";
import { PRIMARY_SOURCE_DOMAINS } from "./research-queries";

const RETURNING_RESIDENT_TOPIC = {
  title: "每两年回英国一次，永居就一定不会出问题吗？",
  question: "长期住在海外的英国永居持有人，短期回英国探亲或处理房产，是否足以避免日后回英定居的身份风险？",
  business: "永居 / ILR / Returning Resident",
  audience: "长期居住海外、持有英国永居的人",
};

// TEST 1 — schema: only these three string fields, nothing else.
describe("ResearchQueryPlanSchema", () => {
  it("accepts exactly official_query, legal_query, general_query", () => {
    const parsed = ResearchQueryPlanSchema.safeParse({
      official_query: "a",
      legal_query: "b",
      general_query: "c",
    });
    expect(parsed.success).toBe(true);
  });

  it("has exactly these three fields — no analysis/reasoning/answer/sources/confidence/etc.", () => {
    expect(Object.keys(ResearchQueryPlanSchema.shape).sort()).toEqual(
      ["general_query", "legal_query", "official_query"].sort(),
    );
  });

  it("rejects a missing field", () => {
    expect(ResearchQueryPlanSchema.safeParse({ official_query: "a", legal_query: "b" }).success).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(
      ResearchQueryPlanSchema.safeParse({ official_query: "", legal_query: "b", general_query: "c" }).success,
    ).toBe(false);
  });

  it("rejects an unreasonably long query", () => {
    const tooLong = "x".repeat(300);
    expect(
      ResearchQueryPlanSchema.safeParse({ official_query: tooLong, legal_query: "b", general_query: "c" }).success,
    ).toBe(false);
  });
});

describe("RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT", () => {
  it("declares itself a search-query planner, not a legal researcher", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("search-query planner, not a legal researcher");
  });

  // TEST 2
  it("requires English-only output queries", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("Output English queries only");
  });

  // TEST 3
  it("explicitly forbids answering the research question", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("Do NOT answer the research question");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("legal conclusion");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain('"safe to say," or "do not say"');
  });

  // TEST 4
  it("forbids inventing URLs and Immigration Rules paragraph numbers", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("Do NOT output any URL");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("Do NOT invent Immigration Rules paragraph numbers");
  });

  // TEST 5 — the user's own premise (e.g. specific £ figures) is not evidence
  it("treats the user's own stated premise as a direction to investigate, not verified fact", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("Do NOT treat the user's own stated premise as verified fact");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("processing cost is only £310");
  });

  it("does not maintain a hard-coded Chinese-English dictionary in the prompt text itself", () => {
    // The prompt may give ONE illustrative example set, but must not read
    // like a lookup table the model is instructed to apply mechanically.
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("from your own knowledge of the domain, not from a lookup table");
  });

  it("keeps queries concise without a rigid word-count requirement overriding quality", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("5-18 English words");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("Don't sacrifice search quality just to hit a word count");
  });

  it("distinguishes the three queries' distinct jobs", () => {
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("official_query:");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("legal_query:");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain("general_query:");
    expect(RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT).toContain('Do not include a domain name (e.g. "gov.uk") in the query text');
  });
});

describe("buildResearchQueryPlannerUserPrompt", () => {
  it("includes the real topic fields, not search results (it runs before Search)", () => {
    const prompt = buildResearchQueryPlannerUserPrompt(RETURNING_RESIDENT_TOPIC);
    expect(prompt).toContain(RETURNING_RESIDENT_TOPIC.title);
    expect(prompt).toContain(RETURNING_RESIDENT_TOPIC.question);
    expect(prompt).toContain(RETURNING_RESIDENT_TOPIC.business);
    expect(prompt).toContain(RETURNING_RESIDENT_TOPIC.audience);
  });

  it("omits empty optional fields rather than printing blank lines", () => {
    const prompt = buildResearchQueryPlannerUserPrompt({ title: "t", question: "", business: "", audience: "" });
    expect(prompt).not.toContain("Research question: \n");
  });
});

describe("cleanResearchQueryPlan", () => {
  it("trims and collapses internal whitespace deterministically (no keyword rewriting)", () => {
    const cleaned = cleanResearchQueryPlan({
      official_query: "  indefinite   leave to remain   lapse  ",
      legal_query: "Home Office\nguidance  returning residents",
      general_query: "UK ILR overseas",
    });
    expect(cleaned.official_query).toBe("indefinite leave to remain lapse");
    expect(cleaned.legal_query).toBe("Home Office guidance returning residents");
  });
});

// TEST 6 — planner → search handoff
describe("planToResearchSearchQueries", () => {
  it("converts official_query/legal_query into official-domain-restricted searches, and general_query into an unrestricted one", () => {
    const queries = planToResearchSearchQueries({
      official_query: "A",
      legal_query: "B",
      general_query: "C",
    });
    expect(queries).toEqual([
      { query: "A", includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_PRIMARY" },
      { query: "B", includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_LEGAL" },
      { query: "C", lane: "GENERAL" },
    ]);
  });

  // TEST 7 — still exactly 3 searches
  it("always produces exactly 3 search queries", () => {
    expect(planToResearchSearchQueries({ official_query: "a", legal_query: "b", general_query: "c" })).toHaveLength(3);
  });

  it("applies the same deterministic whitespace cleanup before conversion", () => {
    const queries = planToResearchSearchQueries({
      official_query: "  A   query  ",
      legal_query: "B",
      general_query: "C",
    });
    expect(queries[0].query).toBe("A query");
  });
});

// TEST 12 — no provider bypass: this module must stay pure infrastructure,
// never importing a provider SDK directly or hard-coding an endpoint/model id.
describe("no provider bypass (source-level check)", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/ai/research-query-planner.ts"), "utf8");

  it("does not import any AI provider module directly", () => {
    expect(source).not.toMatch(/from ["']\.\/providers\//);
    expect(source).not.toContain("openai-provider");
    expect(source).not.toContain("anthropic-provider");
    expect(source).not.toContain("google-provider");
  });

  it("does not hard-code a model id or API endpoint", () => {
    expect(source).not.toContain("gpt-5.6-terra");
    expect(source).not.toContain("api.openai.com");
    expect(source).not.toContain("api.anthropic.com");
  });

  it('has no `import "server-only"` statement — stays a pure, network-free module', () => {
    expect(source).not.toMatch(/import\s+["']server-only["']/);
  });
});
