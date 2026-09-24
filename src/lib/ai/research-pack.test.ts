import { describe, expect, it } from "vitest";
import {
  RESEARCH_SCORE_DIMENSIONS,
  buildGroundedPack,
  buildResearchUserPrompt,
  canApproveResearchScore,
  diagnoseResearchScore,
  groundSources,
  normalizeScoreBreakdown,
  parseResearchPackJson,
  researchDecisionTier,
  totalScore,
} from "./research-pack";

const FULL_SCORES = {
  official_sources: { score: 20, reason: "a" },
  fact_accuracy: { score: 20, reason: "a" },
  policy_timeline: { score: 20, reason: "a" },
  scope_exceptions: { score: 15, reason: "a" },
  data_reliability: { score: 10, reason: "a" },
  external_safety: { score: 15, reason: "a" },
};

describe("normalizeScoreBreakdown — B｜政策研究员's six-dimension score", () => {
  it("carries through a fully-formed claim with each dimension's fixed max", () => {
    const breakdown = normalizeScoreBreakdown(FULL_SCORES);
    expect(breakdown.officialSources).toEqual({ score: 20, max: 20, reason: "a" });
    expect(breakdown.scopeExceptions).toEqual({ score: 15, max: 15, reason: "a" });
    expect(totalScore(breakdown)).toBe(100);
  });

  it("defaults a missing dimension to 0 with an explicit reason, never silently omitted", () => {
    const { official_sources, ...rest } = FULL_SCORES;
    void official_sources;
    const breakdown = normalizeScoreBreakdown(rest);
    expect(breakdown.officialSources.score).toBe(0);
    expect(breakdown.officialSources.max).toBe(20);
    expect(breakdown.officialSources.reason).toMatch(/未提供有效打分/);
  });

  it("clamps an out-of-range score to the dimension's max rather than trusting it", () => {
    const breakdown = normalizeScoreBreakdown({ ...FULL_SCORES, fact_accuracy: { score: 999, reason: "a" } });
    expect(breakdown.factAccuracy.score).toBe(20);
  });

  it("clamps a negative score to 0", () => {
    const breakdown = normalizeScoreBreakdown({ ...FULL_SCORES, data_reliability: { score: -5, reason: "a" } });
    expect(breakdown.dataReliability.score).toBe(0);
  });

  it("defaults every dimension to 0 when given a non-object", () => {
    const breakdown = normalizeScoreBreakdown(null);
    expect(totalScore(breakdown)).toBe(0);
  });

  it("the six dimensions' max values sum to exactly 100", () => {
    expect(RESEARCH_SCORE_DIMENSIONS.reduce((sum, d) => sum + d.max, 0)).toBe(100);
  });
});

describe("parseResearchPackJson", () => {
  const valid = JSON.stringify({
    summary: "总结内容",
    key_findings: ["发现一", "发现二"],
    sources: [{ title: "来源标题", url: "https://www.gov.uk/example", note: "说明" }],
    warnings: "",
    confidence: "HIGH",
  });

  it("parses a well-formed JSON response", () => {
    const result = parseResearchPackJson(valid);
    expect(result.summary).toBe("总结内容");
    expect(result.key_findings).toEqual(["发现一", "发现二"]);
    expect(result.sources).toEqual([
      { title: "来源标题", url: "https://www.gov.uk/example", note: "说明" },
    ]);
    expect(result.confidence).toBe("HIGH");
    expect(result.confidenceInferred).toBe(false);
  });

  it("strips a markdown code fence around the JSON", () => {
    const fenced = "```json\n" + valid + "\n```";
    expect(parseResearchPackJson(fenced).summary).toBe("总结内容");
  });

  it("defaults a missing source note to an empty string", () => {
    const noNote = JSON.stringify({
      summary: "x",
      key_findings: [],
      sources: [{ title: "t", url: "https://example.com" }],
      warnings: "",
      confidence: "MEDIUM",
    });
    expect(parseResearchPackJson(noNote).sources[0].note).toBe("");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseResearchPackJson("not json")).toThrow();
  });

  it("throws when summary is missing", () => {
    const missing = JSON.stringify({ key_findings: [], sources: [], warnings: "" });
    expect(() => parseResearchPackJson(missing)).toThrow(/summary/);
  });

  it("throws when a source is missing a url", () => {
    const badSource = JSON.stringify({
      summary: "x",
      key_findings: [],
      sources: [{ title: "only a title" }],
      warnings: "",
    });
    expect(() => parseResearchPackJson(badSource)).toThrow(/sources/);
  });

  it("throws when key_findings contains a non-string element (schema validation)", () => {
    const badFindings = JSON.stringify({
      summary: "x",
      key_findings: ["ok", { not: "a string" }],
      sources: [],
      warnings: "",
    });
    expect(() => parseResearchPackJson(badFindings)).toThrow(/key_findings/);
  });

  it("throws when key_findings is a string instead of an array (schema validation)", () => {
    const badFindings = JSON.stringify({
      summary: "x",
      key_findings: "should be an array",
      sources: [],
      warnings: "",
    });
    expect(() => parseResearchPackJson(badFindings)).toThrow(/key_findings/);
  });

  it("throws when sources is missing entirely (schema validation)", () => {
    const noSources = JSON.stringify({ summary: "x", key_findings: [], warnings: "" });
    expect(() => parseResearchPackJson(noSources)).toThrow(/sources/);
  });

  describe("LOW-confidence handling", () => {
    it("passes through an explicit LOW confidence unchanged", () => {
      const low = JSON.stringify({
        summary: "x",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "LOW",
      });
      const result = parseResearchPackJson(low);
      expect(result.confidence).toBe("LOW");
      expect(result.confidenceInferred).toBe(false);
    });

    it("defaults to LOW and marks it inferred when confidence is missing", () => {
      const missing = JSON.stringify({ summary: "x", key_findings: [], sources: [], warnings: "" });
      const result = parseResearchPackJson(missing);
      expect(result.confidence).toBe("LOW");
      expect(result.confidenceInferred).toBe(true);
    });

    it("defaults to LOW when confidence is an invalid value — never silently upgraded", () => {
      const invalid = JSON.stringify({
        summary: "x",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "VERY_SURE",
      });
      const result = parseResearchPackJson(invalid);
      expect(result.confidence).toBe("LOW");
      expect(result.confidenceInferred).toBe(true);
    });

    it("normalizes case (e.g. lowercase 'high')", () => {
      const lower = JSON.stringify({
        summary: "x",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "high",
      });
      const result = parseResearchPackJson(lower);
      expect(result.confidence).toBe("HIGH");
      expect(result.confidenceInferred).toBe(false);
    });
  });
});

describe("groundSources — the anti-hallucination guarantee", () => {
  const realResults = [
    { title: "GOV.UK — eVisa", url: "https://www.gov.uk/example-evisa", pageAge: "2 months ago" },
    { title: "UKVI account guidance", url: "https://www.gov.uk/example-evisa-account", pageAge: null },
  ];

  it("keeps a claimed source that matches a real search result, carrying over its page age", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "GOV.UK — eVisa", url: "https://www.gov.uk/example-evisa", note: "n" }],
      realResults,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].pageAge).toBe("2 months ago");
    expect(droppedCount).toBe(0);
  });

  it("drops a fabricated source that was never actually searched", () => {
    const { sources, droppedCount } = groundSources(
      [
        { title: "GOV.UK — eVisa", url: "https://www.gov.uk/example-evisa", note: "n" },
        { title: "made up citation", url: "https://not-a-real-search-result.example/x", note: "n" },
      ],
      realResults,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("https://www.gov.uk/example-evisa");
    expect(droppedCount).toBe(1);
  });

  it("drops everything when the model returns no real search results at all", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "invented", url: "https://invented.example", note: "n" }],
      [],
    );
    expect(sources).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("matches urls regardless of trailing slash or case", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "x", url: "HTTPS://WWW.GOV.UK/example-evisa/", note: "n" }],
      realResults,
    );
    expect(sources).toHaveLength(1);
    expect(droppedCount).toBe(0);
  });

  it("does not match a URL that only differs by scheme (http vs https) — no false grounding", () => {
    const { sources, droppedCount } = groundSources(
      [{ title: "x", url: "http://www.gov.uk/example-evisa", note: "n" }],
      realResults,
    );
    expect(sources).toHaveLength(0);
    expect(droppedCount).toBe(1);
  });

  it("null page_age is preserved as null, not coerced to a string", () => {
    const { sources } = groundSources(
      [{ title: "x", url: "https://www.gov.uk/example-evisa-account", note: "n" }],
      realResults,
    );
    expect(sources[0].pageAge).toBeNull();
  });
});

describe("buildGroundedPack", () => {
  const realResults = [{ title: "GOV.UK", url: "https://www.gov.uk/example-evisa", pageAge: "1 week ago" }];

  it("appends a warning noting how many sources were dropped", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: ["f"],
        sources: [
          { title: "real", url: "https://www.gov.uk/example-evisa", note: "n" },
          { title: "fake", url: "https://fabricated.example", note: "n" },
        ],
        warnings: "",
        confidence: "MEDIUM",
        confidenceInferred: false,
      scoreBreakdown: {
        officialSources: { score: 18, max: 20, reason: "r" },
        factAccuracy: { score: 18, max: 20, reason: "r" },
        policyTimeline: { score: 18, max: 20, reason: "r" },
        scopeExceptions: { score: 13, max: 15, reason: "r" },
        dataReliability: { score: 9, max: 10, reason: "r" },
        externalSafety: { score: 13, max: 15, reason: "r" },
      },
      },
      realResults,
    );
    expect(pack.sources).toHaveLength(1);
    expect(pack.warnings).toMatch(/1/);
  });

  it("leaves warnings untouched when nothing was dropped and confidence was explicit", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [{ title: "real", url: "https://www.gov.uk/example-evisa", note: "n" }],
        warnings: "原始警告",
        confidence: "HIGH",
        confidenceInferred: false,
      scoreBreakdown: {
        officialSources: { score: 18, max: 20, reason: "r" },
        factAccuracy: { score: 18, max: 20, reason: "r" },
        policyTimeline: { score: 18, max: 20, reason: "r" },
        scopeExceptions: { score: 13, max: 15, reason: "r" },
        dataReliability: { score: 9, max: 10, reason: "r" },
        externalSafety: { score: 13, max: 15, reason: "r" },
      },
      },
      realResults,
    );
    expect(pack.warnings).toBe("原始警告");
  });

  it("carries the confidence level through to the grounded pack", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "LOW",
        confidenceInferred: false,
      scoreBreakdown: {
        officialSources: { score: 18, max: 20, reason: "r" },
        factAccuracy: { score: 18, max: 20, reason: "r" },
        policyTimeline: { score: 18, max: 20, reason: "r" },
        scopeExceptions: { score: 13, max: 15, reason: "r" },
        dataReliability: { score: 9, max: 10, reason: "r" },
        externalSafety: { score: 13, max: 15, reason: "r" },
      },
      },
      [],
    );
    expect(pack.confidence).toBe("LOW");
  });

  it("appends an explanatory note when confidence had to be defaulted", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [],
        warnings: "",
        confidence: "LOW",
        confidenceInferred: true,
      scoreBreakdown: {
        officialSources: { score: 18, max: 20, reason: "r" },
        factAccuracy: { score: 18, max: 20, reason: "r" },
        policyTimeline: { score: 18, max: 20, reason: "r" },
        scopeExceptions: { score: 13, max: 15, reason: "r" },
        dataReliability: { score: 9, max: 10, reason: "r" },
        externalSafety: { score: 13, max: 15, reason: "r" },
      },
      },
      [],
    );
    expect(pack.warnings).toMatch(/置信度/);
  });

  it("carries page_age through into the final grounded sources", () => {
    const pack = buildGroundedPack(
      {
        summary: "s",
        key_findings: [],
        sources: [{ title: "real", url: "https://www.gov.uk/example-evisa", note: "n" }],
        warnings: "",
        confidence: "HIGH",
        confidenceInferred: false,
      scoreBreakdown: {
        officialSources: { score: 18, max: 20, reason: "r" },
        factAccuracy: { score: 18, max: 20, reason: "r" },
        policyTimeline: { score: 18, max: 20, reason: "r" },
        scopeExceptions: { score: 13, max: 15, reason: "r" },
        dataReliability: { score: 9, max: 10, reason: "r" },
        externalSafety: { score: 13, max: 15, reason: "r" },
      },
      },
      realResults,
    );
    expect(pack.sources[0].pageAge).toBe("1 week ago");
  });
});

describe("buildResearchUserPrompt", () => {
  it("includes all provided topic fields", () => {
    const prompt = buildResearchUserPrompt({
      title: "老永居离境超过2年，身份还在吗？",
      question: "老永居离境超过2年，身份还在吗？",
      business: "永居 / ILR",
      audience: "持老式永居（ILR）并长期离境的申请人",
    });
    expect(prompt).toContain("老永居离境超过2年，身份还在吗？");
    expect(prompt).toContain("永居 / ILR");
  });

  it("omits empty optional fields instead of printing blank lines", () => {
    const prompt = buildResearchUserPrompt({
      title: "标题",
      question: "",
      business: "",
      audience: "",
    });
    expect(prompt).not.toContain("Question this content should answer:");
    expect(prompt).not.toContain("Business / practice area:");
  });
});

/**
 * Live audit finding: B｜政策研究员's own Skill (docs/digital-employee-
 * skills.md "11. 总分对应结果") has always defined 90-100 = APPROVED, 80-89
 * = APPROVED WITH CAUTION, 70-79 = RESEARCH MORE, <70 = REJECT, but
 * nothing server-side ever actually enforced the 80-point line before
 * approving a research pack. canApproveResearchScore is the single source
 * of truth both the review UI and the approve-research server action read
 * from, so they can't drift apart.
 */
describe("canApproveResearchScore / researchDecisionTier — the real approval boundary", () => {
  it("46/100 cannot be approved, and is REJECT-tier", () => {
    expect(canApproveResearchScore(46)).toBe(false);
    expect(researchDecisionTier(46)).toBe("REJECT");
  });

  it("75/100 cannot be approved, and is RESEARCH_MORE-tier", () => {
    expect(canApproveResearchScore(75)).toBe(false);
    expect(researchDecisionTier(75)).toBe("RESEARCH_MORE");
  });

  it("exactly 79 cannot be approved (the RESEARCH_MORE/APPROVED_WITH_CAUTION boundary)", () => {
    expect(canApproveResearchScore(79)).toBe(false);
    expect(researchDecisionTier(79)).toBe("RESEARCH_MORE");
  });

  it("exactly 80 can be approved, and is APPROVED_WITH_CAUTION-tier", () => {
    expect(canApproveResearchScore(80)).toBe(true);
    expect(researchDecisionTier(80)).toBe("APPROVED_WITH_CAUTION");
  });

  it("82/100 can be approved", () => {
    expect(canApproveResearchScore(82)).toBe(true);
    expect(researchDecisionTier(82)).toBe("APPROVED_WITH_CAUTION");
  });

  it("exactly 90 is APPROVED-tier (not just APPROVED_WITH_CAUTION)", () => {
    expect(researchDecisionTier(90)).toBe("APPROVED");
  });

  it("95/100 can be approved, and is APPROVED-tier", () => {
    expect(canApproveResearchScore(95)).toBe(true);
    expect(researchDecisionTier(95)).toBe("APPROVED");
  });

  it("treats a missing score as 0 (REJECT, cannot approve) rather than throwing or defaulting to approvable", () => {
    expect(canApproveResearchScore(null)).toBe(false);
    expect(canApproveResearchScore(undefined)).toBe(false);
    expect(researchDecisionTier(null)).toBe("REJECT");
  });
});

/**
 * "研究诊断" — deterministic UI mapping from the six-dimension score to the
 * 2-4 problems that actually matter. Live product instruction: this must
 * NOT be another AI call just to restate `reason` more nicely — it's a
 * pure function of scores already on the pack.
 */
describe("diagnoseResearchScore", () => {
  it("returns nothing when every dimension is already healthy (>=80% of its max)", () => {
    const breakdown = normalizeScoreBreakdown(FULL_SCORES);
    expect(diagnoseResearchScore(breakdown)).toEqual([]);
  });

  it("returns nothing for a pack with no real score data (predates scoring, or scoring failed)", () => {
    expect(diagnoseResearchScore(null)).toEqual([]);
    expect(diagnoseResearchScore(undefined)).toEqual([]);
  });

  it("flags a dimension below 50% of its max as HIGH severity, using the model's own reason text", () => {
    const breakdown = normalizeScoreBreakdown({
      ...FULL_SCORES,
      official_sources: { score: 5, reason: "核心改革问题缺少官方原始文件直接支持" },
    });
    const diagnosis = diagnoseResearchScore(breakdown);
    expect(diagnosis).toHaveLength(1);
    expect(diagnosis[0].severity).toBe("HIGH");
    expect(diagnosis[0].label).toBe("官方来源不足");
    expect(diagnosis[0].detail).toBe("核心改革问题缺少官方原始文件直接支持");
  });

  it("flags a dimension between 50% and 80% of its max as MEDIUM severity", () => {
    const breakdown = normalizeScoreBreakdown({
      ...FULL_SCORES,
      policy_timeline: { score: 12, reason: "过渡安排尚未确认" },
    });
    const diagnosis = diagnoseResearchScore(breakdown);
    expect(diagnosis).toHaveLength(1);
    expect(diagnosis[0].severity).toBe("MEDIUM");
    expect(diagnosis[0].label).toBe("时间线不明确");
  });

  it("sorts worst-scoring dimensions first and caps at maxItems", () => {
    const breakdown = normalizeScoreBreakdown({
      official_sources: { score: 18, reason: "ok" }, // healthy (90%)
      fact_accuracy: { score: 4, reason: "worst" }, // 20%
      policy_timeline: { score: 10, reason: "mid" }, // 50%
      scope_exceptions: { score: 3, reason: "second worst" }, // 20%
      data_reliability: { score: 2, reason: "third worst" }, // 20%
      external_safety: { score: 6, reason: "fourth worst" }, // 40%
    });
    const diagnosis = diagnoseResearchScore(breakdown, 3);
    expect(diagnosis).toHaveLength(3);
    // fact_accuracy and scope_exceptions/data_reliability all tie at 20% —
    // what matters is official_sources (healthy) is excluded and only the
    // 3 worst make it in.
    expect(diagnosis.map((d) => d.label)).not.toContain("官方来源不足");
  });
});
