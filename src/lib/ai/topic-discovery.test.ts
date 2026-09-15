import { describe, expect, it } from "vitest";
import {
  buildDiscoveryQueries,
  buildTopicDiscoveryUserPrompt,
  filterCandidatesByValidLabels,
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
} from "./topic-discovery";
import type { TopicCandidate } from "./topic-discovery";

const REAL_FAILURE_KEYWORD = "英国永居申请费£3,226，Home Office处理成本为什么只有约£310？";

function candidate(overrides: Partial<TopicCandidate>): TopicCandidate {
  return {
    title: "t",
    question: "q",
    business: "b",
    audience: "a",
    content_pillar: null,
    priority: "MEDIUM",
    source_label: "N1",
    reason: "r",
    ...overrides,
  };
}

describe("buildDiscoveryQueries", () => {
  // TEST 1
  it("directed search: keeps the original question as the primary query, never diluting it with generic 'UK immigration news' / 'UK visa rules update' sweeps", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"), REAL_FAILURE_KEYWORD);
    expect(queries[0]).toBe(REAL_FAILURE_KEYWORD);
    for (const q of queries) {
      expect(q).not.toContain("UK immigration news");
      expect(q).not.toContain("UK visa rules update");
    }
  });

  it("directed search: adds narrow Home Office / GOV.UK variants without duplicating what's already in the keyword", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"), REAL_FAILURE_KEYWORD);
    expect(queries.some((q) => q.includes("Home Office"))).toBe(true);
    expect(queries.some((q) => q.includes("GOV.UK"))).toBe(true);
    expect(queries.length).toBeLessThanOrEqual(3);
  });

  it("directed search: does not append a redundant 'Home Office' query when the keyword already names it", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"), "Home Office visa fee consultation response");
    const homeOfficeCount = queries.filter((q) => (q.match(/Home Office/g) ?? []).length > 0).length;
    // Every query may still legitimately contain "Home Office" once (it's in the keyword itself),
    // but there must be no separate "<keyword> Home Office" query appended on top of it.
    expect(queries).not.toContain(`Home Office visa fee consultation response Home Office`);
    expect(homeOfficeCount).toBeLessThanOrEqual(queries.length);
  });

  it("auto-discovery (no keyword): keeps the generic monthly sweep unchanged", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"));
    expect(queries.length).toBe(3);
    expect(queries.some((q) => q.includes("UK immigration rules changes news"))).toBe(true);
  });
});

describe("buildTopicDiscoveryUserPrompt", () => {
  // TEST 2
  it("directed search: the final prompt surfaces the user's original keyword", () => {
    const prompt = buildTopicDiscoveryUserPrompt("[N1] some result", REAL_FAILURE_KEYWORD);
    expect(prompt).toContain(REAL_FAILURE_KEYWORD);
    expect(prompt).toContain("用户指定搜索方向");
  });

  it("directed search: marks the keyword as the highest-priority direction, not verified evidence", () => {
    const prompt = buildTopicDiscoveryUserPrompt("[N1] some result", REAL_FAILURE_KEYWORD);
    expect(prompt).toContain("最高优先级");
    expect(prompt).toContain("不是已经核实的事实");
  });

  // TEST 3
  it("auto-discovery: with no keyword, the prompt explicitly declares auto-discovery mode", () => {
    const prompt = buildTopicDiscoveryUserPrompt("[N1] some result");
    expect(prompt).toContain("今日自动选题模式");
    expect(prompt).not.toContain("用户指定搜索方向");
  });
});

describe("TOPIC_DISCOVERY_SYSTEM_PROMPT", () => {
  // TEST 4
  it("directed search rules: strict relevance, 1-3 candidates, 0 is valid, no falling back to other immigration news", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Usually 1–3 candidates, never more than 3");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("0 is a completely valid result");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain('do not fall back to suggesting "other immigration topics"');
  });

  // TEST 5
  it("auto-discovery rules: reject first, usually 2-4 candidates, never pad to hit a round number", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("silently reject anything that's just a news restatement");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Usually 2–4 candidates, at most 6");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Never pad the list to hit a round number");
  });

  it("never lets a directed search's own keyword numbers be treated as already-confirmed fact", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("is NOT verified fact");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Never fabricate a figure");
  });
});

describe("filterCandidatesByValidLabels", () => {
  // TEST 6
  it("drops a candidate whose source_label is not one of the real search result labels, keeping the valid one", () => {
    const candidates = [candidate({ source_label: "N1" }), candidate({ source_label: "N99" })];
    const filtered = filterCandidatesByValidLabels(candidates, ["N1", "N2"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].source_label).toBe("N1");
  });

  it("drops a candidate with an empty source_label", () => {
    const candidates = [candidate({ source_label: "" })];
    expect(filterCandidatesByValidLabels(candidates, ["N1"])).toHaveLength(0);
  });

  // TEST 8 — no padding back in after filtering
  it("returns exactly one candidate when only one survives, without topping the list back up", () => {
    const candidates = [candidate({ source_label: "N1" }), candidate({ source_label: "N99" }), candidate({ source_label: "N100" })];
    expect(filterCandidatesByValidLabels(candidates, ["N1"])).toHaveLength(1);
  });

  it("returns an empty array untouched when none of the labels are valid", () => {
    expect(filterCandidatesByValidLabels([candidate({ source_label: "N9" })], ["N1", "N2"])).toEqual([]);
  });

  it("returns an empty array as-is when there are no candidates at all", () => {
    expect(filterCandidatesByValidLabels([], ["N1"])).toEqual([]);
  });
});

// TEST 7 — real failure scenario as a fixture: a directed search about ILR
// fees mixed with unrelated-but-same-broad-category results. The system
// prompt (asserted above) is what enforces this at generation time; this
// fixture documents the exact real case Round 3A was fixing and pins the
// prompt-construction side of it (keyword surfaced, search not diluted).
describe("real failure fixture — ILR fee vs. processing cost", () => {
  const searchResults = [
    { label: "N1", title: "Home Office immigration and nationality fees: processing costs", url: "https://gov.uk/a", snippet: "processing cost detail", publishedDate: null },
    { label: "N2", title: "十年永居：离境180天规则详解", url: "https://example.com/b", snippet: "absence rules for long residence", publishedDate: null },
    { label: "N3", title: "学生签证资金要求最新变化", url: "https://example.com/c", snippet: "student visa funds requirement", publishedDate: null },
  ];

  it("keeps the keyword front and center regardless of what unrelated results the search also returned", () => {
    const manifest = searchResults.map((r) => `[${r.label}] ${r.title} — ${r.snippet}`).join("\n\n");
    const prompt = buildTopicDiscoveryUserPrompt(manifest, REAL_FAILURE_KEYWORD);
    expect(prompt).toContain(REAL_FAILURE_KEYWORD);
    expect(prompt.indexOf(REAL_FAILURE_KEYWORD)).toBeLessThan(prompt.indexOf("N2"));
  });

  it("code-level filtering would reject a candidate the model mislabels against these three real results", () => {
    const candidates = [
      candidate({ source_label: "N1", title: "永居收费为什么可能远高于处理成本？" }),
      candidate({ source_label: "N2", title: "十年永居离境怎么算" }),
      candidate({ source_label: "N99", title: "fabricated label" }),
    ];
    // Simulates the defensive filter router.ts applies — a candidate must
    // cite a real label; N2 is a real label but the *content* relevance
    // gate (enforced by the system prompt, not code) is what should have
    // stopped the model from proposing it in the first place. Code only
    // guards against hallucinated labels like N99 here.
    const filtered = filterCandidatesByValidLabels(candidates, ["N1", "N2", "N3"]);
    expect(filtered.map((c) => c.source_label)).toEqual(["N1", "N2"]);
    expect(filtered.some((c) => c.source_label === "N99")).toBe(false);
  });
});
