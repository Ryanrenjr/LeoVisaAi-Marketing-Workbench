import { describe, expect, it } from "vitest";
import {
  RESEARCH_OPTIMIZATION_SYSTEM_PROMPT,
  ResearchOptimizationContentClaimSchema,
  buildResearchOptimizationUserPrompt,
  buildOptimizedContent,
  RESEARCH_AUDIT_SYSTEM_PROMPT,
  ResearchAuditClaimSchema,
  buildResearchAuditUserPrompt,
  combineAuditedOptimizationPack,
} from "./research-optimization";
import type { SearchResult } from "../search/types";

const TOPIC = {
  title: "英国5年永居真的要变10年？已经在工签路上的人怎么办？",
  question: "英国5年永居真的要变10年？已经在工签路上的人怎么办？",
  business: "永居 / ILR",
  audience: "在英工签持有人",
};

const PREVIOUS_PACK = {
  summary: "改革方向已宣布，但正式规则尚未公布。",
  keyFindings: ["政府已宣布改革意向，尚无 Statement of Changes"],
  warnings: "过渡安排未知",
  confidence: "LOW" as const,
  scoreBreakdown: {
    officialSources: { score: 8, max: 20, reason: "缺少官方原始文件" },
    factAccuracy: { score: 15, max: 20, reason: "ok" },
    policyTimeline: { score: 6, max: 20, reason: "过渡安排尚未确认" },
    scopeExceptions: { score: 5, max: 15, reason: "适用范围不明确" },
    dataReliability: { score: 10, max: 10, reason: "ok" },
    externalSafety: { score: 10, max: 15, reason: "ok" },
  },
};

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "GOV.UK — ILR guidance",
    url: "https://www.gov.uk/ilr-guidance",
    snippet: "Official summary.",
    publisher: "gov.uk",
    publishedDate: "3 months ago",
    pageAge: "3 months ago",
    retrievedAt: "2026-09-20T00:00:00.000Z",
    provider: "TAVILY",
    ...overrides,
  };
}

/**
 * Live audit finding (2026-09): the first version of this feature let one
 * model call both fix the research AND re-score it, with the previous
 * round's score sitting right there in its own context — not independent
 * scoring, no matter how strongly the prompt said "don't just raise the
 * number." These tests lock in the split: the CONTENT prompt/schema never
 * produces a score, and the separate AUDIT prompt/schema never sees one.
 */
describe("RESEARCH_OPTIMIZATION_SYSTEM_PROMPT (content call)", () => {
  it("carries the evidence hierarchy / evidence-type rules forward", () => {
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toContain("Evidence hierarchy");
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toContain("OFFICIAL_EXTRACT");
  });

  it("explicitly tells the model it is NOT scoring this call, and its output has no scores field", () => {
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toMatch(/You are NOT scoring this research/);
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toMatch(/must NOT include a "scores" field/);
  });

  it("requires an honest 'NOT YET CONFIRMABLE' admission instead of speculation", () => {
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toContain("NOT YET CONFIRMABLE");
  });

  it("only allows a topic revision suggestion for the specific 'topic overstated the evidence' case", () => {
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toContain("topic_revision_suggestion");
    expect(RESEARCH_OPTIMIZATION_SYSTEM_PROMPT).toMatch(/never rewrite the topic yourself/i);
  });
});

describe("ResearchOptimizationContentClaimSchema", () => {
  it("accepts a well-formed claim with no scores field at all", () => {
    const parsed = ResearchOptimizationContentClaimSchema.safeParse({
      summary: "s",
      key_findings: ["f1"],
      source_references: ["S1"],
      warnings: "",
      confidence: "MEDIUM",
      topic_revision_suggestion: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("has no 'scores' key in its shape — the content call cannot grade its own work even if it tried", () => {
    expect(Object.keys(ResearchOptimizationContentClaimSchema.shape)).not.toContain("scores");
  });

  it("accepts a real topic_revision_suggestion with audience: null", () => {
    const parsed = ResearchOptimizationContentClaimSchema.safeParse({
      summary: "s",
      key_findings: ["f1"],
      source_references: ["S1"],
      warnings: "",
      confidence: "MEDIUM",
      topic_revision_suggestion: {
        title: "英国永居5年变10年，现在到底确定了什么？",
        question: "目前已经确定了什么？哪些仍然没有正式答案？",
        audience: null,
        reason: "原标题假设改革已经确定，但正式规则和过渡安排尚未公布。",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a topic_revision_suggestion that also includes a suggested audience", () => {
    const parsed = ResearchOptimizationContentClaimSchema.safeParse({
      summary: "s",
      key_findings: [],
      source_references: [],
      warnings: "",
      confidence: "MEDIUM",
      topic_revision_suggestion: {
        title: "t",
        question: "q",
        audience: "已在英国工签路径上、尚未拿到永居的人",
        reason: "原标题暗示适用于所有工签持有人，实际上只适用于已经在路径上的人",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a topic_revision_suggestion missing the audience key entirely — it must always be present (null or a string)", () => {
    const parsed = ResearchOptimizationContentClaimSchema.safeParse({
      summary: "s",
      key_findings: [],
      source_references: [],
      warnings: "",
      confidence: "MEDIUM",
      topic_revision_suggestion: { title: "t", question: "q", reason: "r" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("buildResearchOptimizationUserPrompt", () => {
  it("includes the previous round's summary, findings, warnings, and confidence", () => {
    const prompt = buildResearchOptimizationUserPrompt(TOPIC, PREVIOUS_PACK, ["q1", "q2"], "manifest");
    expect(prompt).toContain(PREVIOUS_PACK.summary);
    expect(prompt).toContain(PREVIOUS_PACK.keyFindings[0]);
    expect(prompt).toContain(PREVIOUS_PACK.warnings);
    expect(prompt).toContain("LOW");
  });

  it("includes every dimension's previous score and reason, so the model works from the real gap", () => {
    const prompt = buildResearchOptimizationUserPrompt(TOPIC, PREVIOUS_PACK, [], "manifest");
    expect(prompt).toContain("8/20");
    expect(prompt).toContain("缺少官方原始文件");
    expect(prompt).toContain("5/15");
    expect(prompt).toContain("适用范围不明确");
  });

  it("includes the new targeted queries and the new evidence manifest", () => {
    const prompt = buildResearchOptimizationUserPrompt(TOPIC, PREVIOUS_PACK, ["site:gov.uk test"], "=== manifest text ===");
    expect(prompt).toContain("site:gov.uk test");
    expect(prompt).toContain("=== manifest text ===");
  });

  it("handles an empty query list (every dimension was already healthy) without claiming new queries ran", () => {
    const prompt = buildResearchOptimizationUserPrompt(TOPIC, PREVIOUS_PACK, [], "manifest");
    expect(prompt).toMatch(/No new targeted search queries were run/);
  });
});

describe("buildOptimizedContent", () => {
  it("grounds sources against the real manifest, and produces no score fields", () => {
    const results = [makeResult({ url: "https://www.gov.uk/a" })];
    const labelToResult = new Map([["S1", results[0]]]);
    const content = buildOptimizedContent(
      {
        summary: "s",
        key_findings: ["f"],
        source_references: ["S1"],
        warnings: "",
        confidence: "MEDIUM",
        topic_revision_suggestion: null,
      },
      labelToResult,
    );
    expect(content.sources).toHaveLength(1);
    expect(content.sources[0].url).toBe("https://www.gov.uk/a");
    expect(content.suggestedTopicRevision).toBeNull();
    expect(content).not.toHaveProperty("scoreBreakdown");
    expect(content).not.toHaveProperty("scoreTotal");
  });

  it("carries a real topic_revision_suggestion through", () => {
    const content = buildOptimizedContent(
      {
        summary: "s",
        key_findings: [],
        source_references: [],
        warnings: "",
        confidence: "LOW",
        topic_revision_suggestion: { title: "新标题", question: "新问题", audience: null, reason: "原标题过于绝对" },
      },
      new Map(),
    );
    expect(content.suggestedTopicRevision).toEqual({
      title: "新标题",
      question: "新问题",
      audience: null,
      reason: "原标题过于绝对",
    });
  });

  it("carries a suggested audience change through when B included one", () => {
    const content = buildOptimizedContent(
      {
        summary: "s",
        key_findings: [],
        source_references: [],
        warnings: "",
        confidence: "LOW",
        topic_revision_suggestion: {
          title: "新标题",
          question: "新问题",
          audience: "已在英国工签路径上、尚未拿到永居的人",
          reason: "原标题暗示适用于所有工签持有人，实际上只适用于已经在路径上的人",
        },
      },
      new Map(),
    );
    expect(content.suggestedTopicRevision?.audience).toBe("已在英国工签路径上、尚未拿到永居的人");
  });

  it("drops a source_reference label that isn't in the manifest, same anti-hallucination guarantee as the base path", () => {
    const content = buildOptimizedContent(
      {
        summary: "s",
        key_findings: [],
        source_references: ["S1", "S99"],
        warnings: "",
        confidence: "LOW",
        topic_revision_suggestion: null,
      },
      new Map([["S1", makeResult()]]),
    );
    expect(content.sources).toHaveLength(1);
    expect(content.warnings).toMatch(/未在检索结果中找到的引用标签/);
  });
});

describe("RESEARCH_AUDIT_SYSTEM_PROMPT (independent audit call)", () => {
  it("explicitly states the auditor has not been told any previous score or reason", () => {
    expect(RESEARCH_AUDIT_SYSTEM_PROMPT).toMatch(/have NOT been told any previous score/);
  });

  it("never mentions an 80-point (or any numeric) approval threshold", () => {
    expect(RESEARCH_AUDIT_SYSTEM_PROMPT).not.toMatch(/\b80\b/);
    expect(RESEARCH_AUDIT_SYSTEM_PROMPT).not.toMatch(/threshold/i);
  });

  it("instructs the auditor to check the summary against the evidence, not just accept confident prose", () => {
    expect(RESEARCH_AUDIT_SYSTEM_PROMPT).toMatch(/overstates what the manifest shows/);
  });

  it("carries the same evidence hierarchy the content call uses, for consistent judgment", () => {
    expect(RESEARCH_AUDIT_SYSTEM_PROMPT).toContain("Evidence hierarchy");
  });
});

describe("ResearchAuditClaimSchema", () => {
  it("accepts a well-formed scores-only claim", () => {
    const parsed = ResearchAuditClaimSchema.safeParse({
      scores: {
        official_sources: { score: 18, reason: "r" },
        fact_accuracy: { score: 18, reason: "r" },
        policy_timeline: { score: 16, reason: "r" },
        scope_exceptions: { score: 12, reason: "r" },
        data_reliability: { score: 9, reason: "r" },
        external_safety: { score: 13, reason: "r" },
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("has no field for summary/findings/confidence — the auditor only ever produces scores", () => {
    expect(Object.keys(ResearchAuditClaimSchema.shape)).toEqual(["scores"]);
  });
});

describe("buildResearchAuditUserPrompt — the audit call's entire input boundary", () => {
  const CONTENT = {
    summary: "新的研究结论。",
    keyFindings: ["新发现一"],
    warnings: "仍有不确定性",
    confidence: "MEDIUM" as const,
  };

  it("includes the new content (summary/findings/warnings/confidence) and the new evidence manifest", () => {
    const prompt = buildResearchAuditUserPrompt(TOPIC, CONTENT, "=== manifest ===");
    expect(prompt).toContain("新的研究结论。");
    expect(prompt).toContain("新发现一");
    expect(prompt).toContain("仍有不确定性");
    expect(prompt).toContain("MEDIUM");
    expect(prompt).toContain("=== manifest ===");
  });

  it("never includes any previous score, previous score_total, or previous reason text — the prompt builder has no such parameter at all", () => {
    // Structural guarantee, not just a string check: buildResearchAuditUserPrompt's
    // signature has no "previousPack"/"scoreBreakdown" parameter to leak from —
    // this test documents that boundary so a future edit can't quietly add one.
    expect(buildResearchAuditUserPrompt.length).toBe(3); // (topic, content, manifestText)
  });
});

describe("combineAuditedOptimizationPack", () => {
  it("takes the score exclusively from the audit claim, never from the content call", () => {
    const content = {
      summary: "s",
      keyFindings: ["f"],
      sources: [],
      warnings: "",
      confidence: "MEDIUM" as const,
      suggestedTopicRevision: null,
    };
    const audit = {
      scores: {
        official_sources: { score: 20, reason: "r" },
        fact_accuracy: { score: 20, reason: "r" },
        policy_timeline: { score: 20, reason: "r" },
        scope_exceptions: { score: 15, reason: "r" },
        data_reliability: { score: 10, reason: "r" },
        external_safety: { score: 15, reason: "r" },
      },
    };
    const pack = combineAuditedOptimizationPack(content, audit);
    expect(pack.scoreTotal).toBe(100);
    expect(pack.summary).toBe("s");
  });

  it("carries the content's suggestedTopicRevision through unchanged", () => {
    const content = {
      summary: "s",
      keyFindings: [],
      sources: [],
      warnings: "",
      confidence: "LOW" as const,
      suggestedTopicRevision: { title: "t", question: "q", audience: null, reason: "r" },
    };
    const audit = {
      scores: {
        official_sources: { score: 5, reason: "r" },
        fact_accuracy: { score: 5, reason: "r" },
        policy_timeline: { score: 5, reason: "r" },
        scope_exceptions: { score: 5, reason: "r" },
        data_reliability: { score: 5, reason: "r" },
        external_safety: { score: 5, reason: "r" },
      },
    };
    const pack = combineAuditedOptimizationPack(content, audit);
    expect(pack.suggestedTopicRevision).toEqual({ title: "t", question: "q", audience: null, reason: "r" });
  });
});
