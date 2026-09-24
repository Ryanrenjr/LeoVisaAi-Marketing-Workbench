import { describe, expect, it } from "vitest";
import {
  buildDiscoveryQueries,
  buildTopicDiscoveryUserPrompt,
  filterCandidatesByValidLabels,
  poolDiscoveryResults,
  hasSufficientAutoEvidence,
  MIN_AUTO_UNIQUE_RESULTS,
  MIN_AUTO_LANES_WITH_RESULTS,
  TOPIC_DISCOVERY_SYSTEM_PROMPT,
  TopicCandidateSchema,
  TopicDiscoveryResultSchema,
  DirectedTopicDiscoveryResultSchema,
  AutoTopicDiscoveryResultSchema,
  AutoSparseTopicDiscoveryResultSchema,
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

  // Round 3C — TEST 1: 5 distinct editorial-lane queries, up from 3 near-duplicates.
  it("auto-discovery (no keyword): generates 5 distinct editorial-lane queries", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"));
    expect(queries).toHaveLength(5);
    expect(new Set(queries).size).toBe(5);
  });

  // TEST 2 — diversity: not 5 synonyms of "Home Office / Immigration Rules"
  it("auto-discovery (no keyword): the 5 queries cover distinct intents (policy / status / major routes / incidents / fees), not 5 rewordings of the same policy-document search", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15")).map((q) => q.toLowerCase());
    expect(queries.some((q) => q.includes("policy"))).toBe(true);
    expect(queries.some((q) => q.includes("evisa") || q.includes("ilr") || q.includes("citizenship"))).toBe(true);
    expect(queries.some((q) => q.includes("student") || q.includes("skilled worker") || q.includes("sponsor"))).toBe(true);
    expect(queries.some((q) => q.includes("border") || q.includes("airline") || q.includes("airport") || q.includes("incident"))).toBe(
      true,
    );
    expect(queries.some((q) => q.includes("fee") || q.includes("deadline") || q.includes("misconception") || q.includes("controversy"))).toBe(
      true,
    );
  });

  // Round 3D — TEST 6: the CURRENT POLICY lane still carries the current month/year.
  it("auto-discovery: the current-policy lane (Lane 1) still carries the current month and year", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"));
    expect(queries[0]).toContain("September 2026");
  });

  // TEST 7 — the real-incident lane keeps a recent-intent date too.
  it("auto-discovery: the real-incident lane (Lane 4) still carries a recent-intent date", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"));
    const incidentLane = queries.find((q) => q.toLowerCase().includes("incident"));
    expect(incidentLane).toBeDefined();
    expect(incidentLane).toContain("September 2026");
  });

  // TEST 5 — at least 2 of the 5 lanes are evergreen: no month/year date at all.
  it("auto-discovery: at least 2 of the 5 lanes are evergreen — no month/year appended", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"));
    const withoutDate = queries.filter((q) => !q.includes("2026") && !q.includes("September"));
    expect(withoutDate.length).toBeGreaterThanOrEqual(2);
  });

  it("auto-discovery: the evergreen lanes still cover practical-status and money/myth intents, not just dropped dates", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"));
    const evergreen = queries.filter((q) => !q.includes("2026") && !q.includes("September")).map((q) => q.toLowerCase());
    expect(evergreen.some((q) => q.includes("ilr") || q.includes("evisa") || q.includes("citizenship") || q.includes("status"))).toBe(true);
    expect(evergreen.some((q) => q.includes("fee") || q.includes("processing cost") || q.includes("myth") || q.includes("misconception"))).toBe(
      true,
    );
  });

  it("auto-discovery: changes month/year in the dated lanes when the date changes, proving it's not hard-coded", () => {
    const septQueries = buildDiscoveryQueries(new Date("2026-09-15"));
    const octQueries = buildDiscoveryQueries(new Date("2026-10-01"));
    expect(septQueries[0]).not.toBe(octQueries[0]);
    expect(octQueries[0]).toContain("October 2026");
  });

  // TEST 3 — directed search must not regress into the new 5-lane AUTO shape
  it("directed search (keyword given): still uses Round 3A's directed logic, never the 5-lane AUTO shape", () => {
    const queries = buildDiscoveryQueries(new Date("2026-09-15"), REAL_FAILURE_KEYWORD);
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(queries[0]).toBe(REAL_FAILURE_KEYWORD);
  });
});

// Round 3C — TEST 4 / TEST 5: pooling and de-duplicating AUTO-discovery's
// 5 editorial-lane search executions.
describe("poolDiscoveryResults", () => {
  function result(url: string, label: string) {
    return { url, label };
  }

  // TEST 4
  it("de-duplicates the same URL appearing across multiple lanes, keeping only the first occurrence", () => {
    const executions = [
      { results: [result("https://www.gov.uk/a", "lane1-a")] },
      { results: [result("https://www.gov.uk/a", "lane2-a-dup")] },
      { results: [result("https://www.gov.uk/b", "lane3-b")] },
    ];
    const pooled = poolDiscoveryResults(executions);
    expect(pooled.map((r) => r.label)).toEqual(["lane1-a", "lane3-b"]);
  });

  it("treats a trailing slash / query string difference as the same URL for dedupe purposes", () => {
    const executions = [
      { results: [result("https://www.gov.uk/a/", "first")] },
      { results: [result("https://www.gov.uk/a", "duplicate")] },
    ];
    expect(poolDiscoveryResults(executions).map((r) => r.label)).toEqual(["first"]);
  });

  // TEST 5 — all 5 lanes must be represented, not just the first lane's results
  it("interleaves round-robin across all lanes instead of concatenating lane 1's results before any other lane is seen", () => {
    const executions = [
      { results: [result("https://a.com/1", "lane1-1"), result("https://a.com/2", "lane1-2"), result("https://a.com/3", "lane1-3")] },
      { results: [result("https://b.com/1", "lane2-1")] },
      { results: [result("https://c.com/1", "lane3-1")] },
      { results: [result("https://d.com/1", "lane4-1")] },
      { results: [result("https://e.com/1", "lane5-1")] },
    ];
    const pooled = poolDiscoveryResults(executions);
    // Every lane's result must appear, and lane 2-5 must not be pushed to
    // the very end just because lane 1 happened to return more results.
    expect(pooled.map((r) => r.label)).toContain("lane2-1");
    expect(pooled.map((r) => r.label)).toContain("lane5-1");
    const lane1Index = pooled.findIndex((r) => r.label === "lane1-2");
    const lane5Index = pooled.findIndex((r) => r.label === "lane5-1");
    expect(lane5Index).toBeLessThan(lane1Index); // lane1's SECOND result comes after every lane's first
  });

  it("handles lanes of uneven length without dropping any real result", () => {
    const executions = [
      { results: [result("https://a.com/1", "a1"), result("https://a.com/2", "a2")] },
      { results: [] },
      { results: [result("https://c.com/1", "c1")] },
    ];
    const pooled = poolDiscoveryResults(executions);
    expect(pooled.map((r) => r.label).sort()).toEqual(["a1", "a2", "c1"].sort());
  });

  it("returns an empty array when every lane returned nothing", () => {
    expect(poolDiscoveryResults([{ results: [] }, { results: [] }])).toEqual([]);
  });
});

describe("TopicDiscoveryResultSchema (unchanged)", () => {
  // TEST 13
  it("still caps at max 6 candidates and has not gained new fields", () => {
    expect(Object.keys(TopicCandidateSchema.shape).sort()).toEqual(
      ["audience", "business", "content_pillar", "priority", "question", "reason", "source_label", "title"].sort(),
    );
    const tooMany = Array.from({ length: 7 }, () => candidate({}));
    expect(TopicDiscoveryResultSchema.safeParse({ candidates: tooMany }).success).toBe(false);
    const sixIsFine = Array.from({ length: 6 }, () => candidate({}));
    expect(TopicDiscoveryResultSchema.safeParse({ candidates: sixIsFine }).success).toBe(true);
  });
});

// Round 3D — AUTO and DIRECTED now use different structured-output
// schemas, because the old shared max(6)-only schema never told the
// model a floor existed: a real production run kept returning 2
// candidates for AUTO, which was always schema-legal even though the
// prompt said "aim for 5-6."
describe("AUTO vs DIRECTED candidate-count schemas", () => {
  function candidates(n: number) {
    return Array.from({ length: n }, () => candidate({}));
  }

  // TEST 1
  it("AUTO and DIRECTED are genuinely different schema objects with different bounds", () => {
    expect(AutoTopicDiscoveryResultSchema).not.toBe(DirectedTopicDiscoveryResultSchema);
    expect(AutoTopicDiscoveryResultSchema.safeParse({ candidates: candidates(3) }).success).toBe(false);
    expect(DirectedTopicDiscoveryResultSchema.safeParse({ candidates: candidates(3) }).success).toBe(true);
  });

  // TEST 2 — normal AUTO (evidence sufficient): schema min 5, max 6
  it("AutoTopicDiscoveryResultSchema requires a hard floor of 5 and a ceiling of 6", () => {
    expect(AutoTopicDiscoveryResultSchema.safeParse({ candidates: candidates(4) }).success).toBe(false);
    expect(AutoTopicDiscoveryResultSchema.safeParse({ candidates: candidates(5) }).success).toBe(true);
    expect(AutoTopicDiscoveryResultSchema.safeParse({ candidates: candidates(6) }).success).toBe(true);
    expect(AutoTopicDiscoveryResultSchema.safeParse({ candidates: candidates(7) }).success).toBe(false);
    // 2 candidates — the exact real production failure — is no longer schema-legal for the normal AUTO path.
    expect(AutoTopicDiscoveryResultSchema.safeParse({ candidates: candidates(2) }).success).toBe(false);
  });

  // TEST 3 — DIRECTED stays max 3, completely unaffected by AUTO's new floor
  it("DirectedTopicDiscoveryResultSchema still allows 0-3 and rejects more than 3, regardless of AUTO's min(5)", () => {
    expect(DirectedTopicDiscoveryResultSchema.safeParse({ candidates: candidates(0) }).success).toBe(true);
    expect(DirectedTopicDiscoveryResultSchema.safeParse({ candidates: candidates(1) }).success).toBe(true);
    expect(DirectedTopicDiscoveryResultSchema.safeParse({ candidates: candidates(3) }).success).toBe(true);
    expect(DirectedTopicDiscoveryResultSchema.safeParse({ candidates: candidates(4) }).success).toBe(false);
  });

  // TEST 4 — the sparse fallback never forces fabrication
  it("AutoSparseTopicDiscoveryResultSchema allows 0-6, never forcing a floor", () => {
    expect(AutoSparseTopicDiscoveryResultSchema.safeParse({ candidates: candidates(0) }).success).toBe(true);
    expect(AutoSparseTopicDiscoveryResultSchema.safeParse({ candidates: candidates(2) }).success).toBe(true);
    expect(AutoSparseTopicDiscoveryResultSchema.safeParse({ candidates: candidates(6) }).success).toBe(true);
    expect(AutoSparseTopicDiscoveryResultSchema.safeParse({ candidates: candidates(7) }).success).toBe(false);
  });
});

// Round 3D — deterministic evidence-sufficiency check that decides
// whether AUTO gets the hard 5-6 schema or the sparse 0-6 fallback.
describe("hasSufficientAutoEvidence", () => {
  it("is sufficient when pooled results >= 5 and >= 3 lanes have results", () => {
    expect(MIN_AUTO_UNIQUE_RESULTS).toBe(5);
    expect(MIN_AUTO_LANES_WITH_RESULTS).toBe(3);
    expect(hasSufficientAutoEvidence(5, [2, 2, 1, 0, 0])).toBe(true);
    expect(hasSufficientAutoEvidence(10, [4, 3, 2, 1, 0])).toBe(true);
  });

  it("is NOT sufficient when pooled results are below the floor, even with many lanes covered", () => {
    expect(hasSufficientAutoEvidence(4, [1, 1, 1, 1, 0])).toBe(false);
  });

  it("is NOT sufficient when volume looks fine but it all came from too few lanes (e.g. one lane dominating)", () => {
    // 6 total results, but only 2 lanes actually returned anything.
    expect(hasSufficientAutoEvidence(6, [4, 2, 0, 0, 0])).toBe(false);
  });

  it("is NOT sufficient when there is barely any evidence at all", () => {
    expect(hasSufficientAutoEvidence(0, [0, 0, 0, 0, 0])).toBe(false);
    expect(hasSufficientAutoEvidence(2, [1, 1, 0, 0, 0])).toBe(false);
  });
});

describe("buildTopicDiscoveryUserPrompt: sparse-evidence note", () => {
  it("includes the honesty note only when options.sparse is true", () => {
    const sparse = buildTopicDiscoveryUserPrompt("[N1] x", undefined, { sparse: true });
    const normal = buildTopicDiscoveryUserPrompt("[N1] x", undefined, { sparse: false });
    const defaulted = buildTopicDiscoveryUserPrompt("[N1] x");
    expect(sparse).toContain("不要为了凑数编造");
    expect(normal).not.toContain("不要为了凑数编造");
    expect(defaulted).not.toContain("不要为了凑数编造");
  });

  it("never adds the sparse note to a directed search, even if sparse were mistakenly passed", () => {
    const prompt = buildTopicDiscoveryUserPrompt("[N1] x", REAL_FAILURE_KEYWORD, { sparse: true });
    expect(prompt).not.toContain("不要为了凑数编造");
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

  // Round 3D — quantity is now a real schema constraint (see the
  // AutoTopicDiscoveryResultSchema tests below), not prompt-wording alone;
  // this just confirms the prompt frames 5-6 as the normal case.
  it("auto-discovery rules: frames 5-6 as the normal case, not the old 'usually 2-4' / 'aim for' wording", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(
      "The platform requires 5–6 candidates whenever the evidence is reasonably sufficient — this is the normal case, not an aspiration",
    );
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).not.toContain("Usually 2–4 candidates");
  });

  // TEST 4 (prompt-side) — sparse fallback is explicitly conditional on the signal from the user prompt, not a default excuse.
  it("auto-discovery rules: only allows fewer than 5 when the sparse-evidence signal is present, never as a default", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Sparse-evidence exception");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("if the user message tells you evidence is sparse this run");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Never fabricate a topic or lower the evidence bar just to force a count");
  });

  // TEST 9 — editorial slate framing, not a policy-news list
  it("auto-discovery rules: frames the output as a daily editorial slate, not a policy bulletin/news list", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Auto-discovery: build a daily editorial slate, not a policy bulletin");
  });

  // TEST 10 — the daily-slate baseline: WHO / QUESTION / STAKE-OR-ACTION / EVIDENCE
  it("auto-discovery rules: WHO + QUESTION + STAKE-OR-ACTION + EVIDENCE form the baseline gate, framed as 'worthy of editorial consideration'", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain('The auto-discovery bar is "worthy of editorial consideration," not "already approved for publication."');
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("**WHO**");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("**QUESTION**");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("**STAKE OR ACTION**");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("**EVIDENCE**");
  });

  // Editorial-boundary clarification: a real incident is only a valid
  // hook when it ties back to a genuine UK immigration/status issue — not
  // just because it happened in/around the UK or to British residents.
  // Added after a real smoke test surfaced a general EES-queue/missed-
  // flight BBC story as a candidate with no UK immigration-status angle.
  it("auto-discovery rules: a real incident hook must tie back to a genuine UK immigration/status issue, not just happen in/around the UK", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Incident eligibility boundary");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(
      "Do not select a general UK news, travel, airline, airport, tourism, EU-border, crime, or social story merely because it happened to British residents or in/around the UK",
    );
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("general EES queues affecting tourists travelling to Europe");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("an eVisa mismatch causes boarding problems for a UK visa holder");
  });

  // TEST 11 — diversity rule: don't let one event/route dominate the whole slate
  it("auto-discovery rules: caps how much the slate can be dominated by one underlying event or visa route", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Editorial mix, not random diversity");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(
      "usually cap candidates drawn from the exact same underlying event or the same visa route at 2",
    );
  });

  // TEST 12 — no invented stories
  it("auto-discovery rules: forbids inventing a story/incident/case not present in the search evidence", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Never fabricate a story for effect");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("never invent a client story, an airport incident, a refusal case");
  });

  // TEST 12 (priority) — LOW defaults to elimination
  it("auto-discovery rules: priority is an editorial judgment call, not just policy formality — weak LOW candidates should be dropped, not kept to pad", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Priority is an editorial call, not a policy-magnitude score");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("should usually be dropped entirely rather than kept to pad the slate");
  });

  // TEST 11 — MEDIUM explicitly welcome in the daily slate, not just tolerated
  it("auto-discovery rules: MEDIUM priority is explicitly welcome in a healthy daily slate, not merely allowed", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("A healthy 5–6 slate is not all HIGH");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("MEDIUM is a real, welcome part of the slate");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("2–3 HIGH plus 2–3 MEDIUM");
  });

  // TEST 9 — counter-intuitive tension downgraded from hard gate to bonus
  it("auto-discovery rules: counter-intuitive tension is a bonus, not a hard requirement for every candidate", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(
      "A counter-intuitive gap or tension (e.g. a large fee vs. a small stated processing cost) is a strong BONUS whenever it's genuinely there — it is NOT a hard requirement",
    );
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("do not reject a solid practical candidate just because it lacks tension");
    // The old numbered "must clear this bar" list no longer forces it as item 3.
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).not.toContain("3. Is there a counter-intuitive gap or tension?");
  });

  // Same-source multi-angle allowance, with the exact real-world example the product owner gave
  it("auto-discovery rules: allows up to 2 genuinely different angles from one strong source, using the student-visa-funds example", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("One strong source can honestly yield up to 2 different candidates");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("生活费要求涨到多少");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("11月30日前后递签，到底按哪个标准");
  });

  it("still silently rejects bare news restatements before proposing anything (unchanged from Round 3A)", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("silently reject bare news restatements first");
  });

  it("never lets a directed search's own keyword numbers be treated as already-confirmed fact", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("is NOT verified fact");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Never fabricate a figure");
  });

  // Round 3B — a real production run correctly kept the core "fee vs.
  // processing cost" angle but also let through a second candidate that
  // only shared the domain ("永居费用") — "一家人申请英国永居，真正要准备
  // 的不只是申请费" (drifted to total family budget). Fixed by adding an
  // explicit "domain-relevant ≠ question-relevant" rule with concrete
  // PASS/FAIL examples lifted straight from this real failure.

  // TEST 1
  it("states the core rule: domain-relevant is not the same as question-relevant", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("Domain-relevant is not question-relevant");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(
      "Sharing the same visa type, immigration category, audience, or cost topic is NOT enough on its own",
    );
  });

  // TEST 2 — the exact real fixture: candidate A should read as the PASS
  // example, candidate B (the real drifted candidate) as a named FAIL example.
  it("names the real PASS candidate (fee vs. processing cost) and the real FAIL candidate (family total budget) from this exact production case", () => {
    const CANDIDATE_A = "英国永居申请费为什么可能远高于实际处理成本？";
    const CANDIDATE_B_CORE = "一家人申请永居总共要准备多少钱？";
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(CANDIDATE_A);
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(CANDIDATE_B_CORE);
    // A must appear under the PASS heading, B under the FAIL heading — not swapped.
    const passIndex = TOPIC_DISCOVERY_SYSTEM_PROMPT.indexOf("PASS (keeps the core relationship)");
    const failIndex = TOPIC_DISCOVERY_SYSTEM_PROMPT.indexOf("FAIL (only shares the domain");
    expect(passIndex).toBeGreaterThan(-1);
    expect(failIndex).toBeGreaterThan(passIndex);
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT.indexOf(CANDIDATE_A)).toBeGreaterThan(passIndex);
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT.indexOf(CANDIDATE_A)).toBeLessThan(failIndex);
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT.indexOf(CANDIDATE_B_CORE)).toBeGreaterThan(failIndex);
  });

  it("requires rejecting a domain-only match even if it clears every other bar in the prompt", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain(
      "that's domain-relevant, not question-relevant, and must be rejected even if it clears every other bar in this prompt",
    );
  });

  // TEST 3
  it("explicitly allows directed search to return exactly one candidate and forbids broadening for diversity", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain('Do not treat "at least 2 candidates" or "some variety" as a goal');
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("One high-quality, tightly on-point candidate beats three loosely-related ones");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("return exactly one");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("don't broaden the topic just to reach 2 or 3");
  });

  it("prefers digging deeper into the same relationship over expanding sideways into adjacent topics", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("go deeper, not wider");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("expanding sideways into adjacent topics");
  });
});

// TEST 4 — Round 3A behavior must not regress after the Round 3B prompt additions.
describe("Round 3A behavior does not regress", () => {
  it("keyword is still surfaced to the model as the highest-priority direction", () => {
    const prompt = buildTopicDiscoveryUserPrompt("[N1] x", REAL_FAILURE_KEYWORD);
    expect(prompt).toContain(REAL_FAILURE_KEYWORD);
    expect(prompt).toContain("最高优先级");
  });

  it("directed search is still capped at 3 and 0 is still explicitly valid", () => {
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("never more than 3");
    expect(TOPIC_DISCOVERY_SYSTEM_PROMPT).toContain("0 is a completely valid result");
  });

  it("invalid source_label filtering still drops hallucinated labels", () => {
    const candidates = [candidate({ source_label: "N1" }), candidate({ source_label: "N99" })];
    expect(filterCandidatesByValidLabels(candidates, ["N1", "N2"])).toEqual([candidate({ source_label: "N1" })]);
  });

  it("TopicCandidateSchema still has exactly the same 8 fields — no core_relation/semantic_anchor/etc. added", () => {
    const shape = Object.keys(TopicCandidateSchema.shape).sort();
    expect(shape).toEqual(
      ["audience", "business", "content_pillar", "priority", "question", "reason", "source_label", "title"],
    );
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
