import { z } from "zod";
import type { SearchResult } from "../search/types";
import type { ResearchConfidence, ResearchScoreBreakdown, SuggestedTopicRevision } from "../types";
import { RESEARCH_SCORE_DIMENSIONS, normalizeScoreBreakdown, totalScore } from "./research-pack";
import type { GroundedResearchPack, GroundedSource } from "./research-pack";

/**
 * B｜政策研究员's "研究优化" mode — a second-stage pass over an existing,
 * already-scored-but-insufficient research pack, not a second parallel
 * research system.
 *
 * Live audit finding (2026-09): the first version of this feature let the
 * SAME model call that rewrote the research also re-score it, with the
 * previous round's score_total and per-dimension reasons sitting right in
 * its own context. A model asked "fix this 46" can trivially decide the
 * fix worked and hand back a 75 without new evidence actually supporting
 * it — a self-review inside one call is not independent scoring, no
 * matter how strongly the prompt insists "don't just raise the number."
 * This is now split into two genuinely separate model calls, each with its
 * own schema and its own (Model-Router-resolved, independently
 * configurable) model:
 *
 * 1. CONTENT (RESEARCH_OPTIMIZATION_SYSTEM_PROMPT /
 *    ResearchOptimizationContentClaimSchema) — sees the previous pack's
 *    summary/findings/warnings/confidence/score_breakdown+reasons (needed
 *    to know what to fix) and the new targeted evidence, and produces
 *    fixed research content. Its own JSON output has no scores field at
 *    all — it is not asked to grade its own work.
 * 2. AUDIT (RESEARCH_AUDIT_SYSTEM_PROMPT / ResearchAuditClaimSchema,
 *    routed through the independent RESEARCH_AUDIT task type) — sees ONLY
 *    the Topic, the NEW content from step 1, and the NEW grounded
 *    evidence. It is never shown the previous score_total, the previous
 *    score_breakdown, the previous reasons, or any hint that a target
 *    score exists — it scores the finished result exactly as if
 *    encountering it for the first time. See runResearchOptimizationTask
 *    in router.ts for how the two calls are sequenced.
 */
const OPTIMIZATION_ADDENDUM = `You are NOT starting this research from zero. A previous round of this same research already ran and was scored across six dimensions — that previous summary, findings, warnings, confidence, and per-dimension score + reason are given to you below, together with a fresh batch of search results specifically retrieved to target whichever dimensions scored low last time.

Your ONLY job in this call is to produce fixed, honest research content. You are NOT scoring this research — a separate, independent reviewer will score the result afterward, and that reviewer will NOT be told what the previous score was or what you changed, so there is no point trying to write toward a target number. Your JSON output for this call must NOT include a "scores" field at all.

For every dimension that scored low last time, decide which of these applies, and act accordingly:

1. FIXABLE WITH MORE EVIDENCE — the new search results below actually close the gap. Use them to write a more complete, better-supported summary/findings.
2. NOT FIXABLE BY SEARCHING HARDER, BUT THE TOPIC OVERSTATED THE EVIDENCE — the new results don't resolve it, and on reflection the topic's own title/question asserts something more certain or more absolute than any evidence (old or new) actually supports. Do not paper over this by hedging the writing alone. Propose a revised title and core question that the evidence genuinely can support, and set "topic_revision_suggestion" with a one-sentence "reason" explaining specifically what the original topic overstated. Only include "audience" in the suggestion when the audience itself is what over-scoped the claim (e.g. the topic implied this applies to a much broader group of people than the evidence actually covers) — leave "audience" as null in every other case; do not suggest an audience change just because you touched the title/question. This is a suggestion for a human to accept or reject — never rewrite the topic yourself.
3. GENUINELY NOT YET CONFIRMABLE — the government/Home Office itself has not published an answer yet, and no realistic further search changes that. State this explicitly (write "NOT YET CONFIRMABLE" in the relevant finding or in warnings) instead of speculating about what the answer will probably turn out to be. Do not simply repeat the same kind of search again expecting a different result — if the answer does not exist yet, searching harder cannot manufacture it.

Only set "topic_revision_suggestion" for case 2 above. If every low-scoring dimension is genuinely resolved by the new evidence (case 1) or is a genuine "not yet confirmable" gap that doesn't call the topic's own framing into question (case 3), set "topic_revision_suggestion" to null — do not suggest a topic change just because a dimension is still imperfect.

Output format: your reply must be ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly this shape:
{
  "summary": "2-4 sentence overview of what the evidence now supports, for a content editor",
  "key_findings": ["short finding 1", "short finding 2", "..."],
  "source_references": ["S1", "S2", "..."],
  "warnings": "caveats, uncertainty, or anything a human should double-check — empty string if none",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "topic_revision_suggestion": { "title": "...", "question": "...", "audience": "..." | null, "reason": "..." } | null
}`;

/**
 * Reuses the evidence-hierarchy framing every research-analysis prompt in
 * this app shares (see EXTERNAL_RESEARCH_SYSTEM_PROMPT in
 * research-external.ts) restated locally rather than imported — this file
 * intentionally does not depend on research-external.ts so the two can be
 * edited independently, and the shared text is short enough that
 * duplicating it once here is cheaper than the coupling.
 */
const EVIDENCE_RULES = `You do NOT have your own web search access. You are given a manifest of REAL search results already retrieved by a separate search step — this is your ONLY evidence base. Treat it as your complete evidence boundary.

Each manifest entry is one of two types:
- **OFFICIAL_EXTRACT** — real content actually retrieved from that official page. Treat it as read, but only about what is actually shown.
- **SEARCH_SNIPPET** — a short search-engine snippet only, not the page itself. Keep treating this as partial evidence.

Evidence hierarchy — when sources conflict, higher wins: (1) Legislation / Immigration Rules / other official statutory text, (2) Home Office caseworker guidance, (3) GOV.UK official public guidance, (4) Parliament or other official material, (5) Reputable professional secondary material, (6) Commercial immigration websites, (7) Social media / forums. An OFFICIAL_EXTRACT from an official source always outweighs a SEARCH_SNIPPET from a lower-ranked source on the same question.

This is general marketing research to inform educational content — never individualized legal advice, never an assessment of any specific person's case. Never fabricate a fact, statistic, policy detail, or URL.`;

export const RESEARCH_OPTIMIZATION_SYSTEM_PROMPT = `You are a marketing research assistant for LeoVisaAi, a UK immigration services marketing team.\n\n${EVIDENCE_RULES}\n\n${OPTIMIZATION_ADDENDUM}`;

const topicRevisionSuggestionSchema = z.object({
  title: z.string(),
  question: z.string(),
  audience: z.string().nullable(),
  reason: z.string(),
});

export const ResearchOptimizationContentClaimSchema = z.object({
  summary: z.string(),
  key_findings: z.array(z.string()),
  source_references: z.array(z.string()),
  warnings: z.string(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  topic_revision_suggestion: topicRevisionSuggestionSchema.nullable(),
});
export type ResearchOptimizationContentClaim = z.infer<typeof ResearchOptimizationContentClaimSchema>;

/**
 * Presents the previous round's full result (not just its score) as context
 * to fix, plus whatever new targeted evidence this optimization pass
 * retrieved. Deliberately does NOT re-include the previous round's own
 * source manifest — the model already saw and used that evidence once, and
 * re-labelling it here would let it cite "S1" ambiguously across two
 * different manifests; it can still reference previously-established facts
 * in prose (summary/key_findings), just not backed by a source label
 * outside what THIS manifest offers.
 */
export function buildResearchOptimizationUserPrompt(
  topic: { title: string; question: string; business: string; audience: string },
  previousPack: {
    summary: string;
    keyFindings: readonly string[];
    warnings: string;
    confidence: ResearchConfidence;
    scoreBreakdown: ResearchScoreBreakdown;
  },
  newQueries: readonly string[],
  manifestText: string,
): string {
  const lines = [
    `Topic title: ${topic.title}`,
    topic.question ? `Question this content should answer: ${topic.question}` : null,
    topic.business ? `Business / practice area: ${topic.business}` : null,
    topic.audience ? `Target audience: ${topic.audience}` : null,
    "",
    "=== 上一轮研究结果（本次要修复的问题基础，不是从零开始）===",
    `Summary: ${previousPack.summary}`,
    previousPack.keyFindings.length > 0
      ? `Key findings:\n${previousPack.keyFindings.map((f) => `- ${f}`).join("\n")}`
      : "Key findings: (none)",
    previousPack.warnings ? `Warnings: ${previousPack.warnings}` : "Warnings: (none)",
    `Confidence: ${previousPack.confidence}`,
    "",
    "=== 上一轮六项评分（找出真正的扣分原因，逐项处理——这是给你诊断问题用的参考，你自己这次不需要，也不会重新打分）===",
    ...RESEARCH_SCORE_DIMENSIONS.map((dim) => {
      const item = previousPack.scoreBreakdown[dim.field];
      return `${dim.label}: ${item.score}/${item.max} — ${item.reason}`;
    }),
    "",
    newQueries.length > 0
      ? `New targeted search queries run for this optimization pass (aimed at the low-scoring dimensions above): ${newQueries.join(" | ")}`
      : "No new targeted search queries were run for this pass (every dimension was already at or above the healthy bar, or no search provider is configured) — re-assess using only the previous evidence and your own judgement about whether the topic's framing still holds.",
    "",
    "=== 本次新检索到的真实搜索结果（本轮新增证据，仅可使用以下标签引用）===",
    manifestText,
    "",
    "Work through the previous round's low-scoring dimensions one at a time as instructed, then reply with the JSON described in your instructions (no scores field) — including topic_revision_suggestion only if this is genuinely a case-2 situation.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export interface OptimizedResearchContent {
  summary: string;
  keyFindings: string[];
  sources: GroundedSource[];
  warnings: string;
  confidence: ResearchConfidence;
  suggestedTopicRevision: SuggestedTopicRevision | null;
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/** How much real page content Round 4's official-source extraction actually retrieved for this run — mirrors research-external.ts's RetrievalMeta so both prompts disclose retrieval depth consistently, without importing from that file. */
export interface RetrievalMeta {
  officialExtractCount: number;
  failedExtractionCount: number;
}

function buildRetrievalDisclosure(meta: RetrievalMeta): string[] {
  const notes: string[] = [];
  notes.push(
    meta.officialExtractCount > 0
      ? `（本次优化研究已提取 ${meta.officialExtractCount} 个官方页面的正文；页面是否直接支持本题，仍以上述研究结论和独立复核为准。）`
      : "（本次优化研究仅基于搜索结果标题与摘要，未读取官方页面正文；如涉及重要细节，请人工核实原始页面。）",
  );
  if (meta.failedExtractionCount > 0) {
    notes.push(
      `（其中 ${meta.failedExtractionCount} 个官方来源尝试读取正文失败，已改用搜索摘要继续研究，不影响本次结果生成。）`,
    );
  }
  return notes;
}

/**
 * Grounds the CONTENT call's claimed sources against the real search
 * manifest (same anti-hallucination guarantee as
 * research-external.ts's buildExternalGroundedPack, reimplemented locally
 * here — see this file's top comment for why) and carries the optional
 * topic-revision suggestion through untouched. Deliberately produces NO
 * score fields — those come only from the independent audit call.
 */
export function buildOptimizedContent(
  claim: ResearchOptimizationContentClaim,
  labelToResult: Map<string, SearchResult>,
  retrievalMeta: RetrievalMeta = { officialExtractCount: 0, failedExtractionCount: 0 },
): OptimizedResearchContent {
  const sources: GroundedSource[] = [];
  const seenUrls = new Set<string>();
  let droppedCount = 0;

  for (const raw of claim.source_references) {
    const result = labelToResult.get(raw.trim());
    if (result) {
      if (!seenUrls.has(normalizeUrl(result.url))) {
        sources.push({ title: result.title, url: result.url, note: result.snippet, pageAge: result.pageAge });
        seenUrls.add(normalizeUrl(result.url));
      }
    } else {
      droppedCount++;
    }
  }

  const notes: string[] = [];
  if (claim.warnings) notes.push(claim.warnings);
  if (droppedCount > 0) {
    notes.push(`（系统已自动移除 ${droppedCount} 条未在检索结果中找到的引用标签）`);
  }
  notes.push(...buildRetrievalDisclosure(retrievalMeta));

  return {
    summary: claim.summary,
    keyFindings: claim.key_findings,
    sources,
    warnings: notes.join(" "),
    confidence: claim.confidence,
    suggestedTopicRevision: claim.topic_revision_suggestion
      ? {
          title: claim.topic_revision_suggestion.title,
          question: claim.topic_revision_suggestion.question,
          audience: claim.topic_revision_suggestion.audience,
          reason: claim.topic_revision_suggestion.reason,
        }
      : null,
  };
}

// ---------------------------------------------------------------------
// Independent audit — a second, separate model call that scores the
// content above without ever seeing the previous round's score.
// ---------------------------------------------------------------------

const AUDIT_INSTRUCTIONS = `You are independently auditing a finished piece of research. You are NOT writing it, and you have NOT been told any previous score, any previous per-dimension reason, or that this research was ever revised — score exactly as if you are seeing this research for the first time, based solely on the content and evidence given to you below. Do not assume a target score; there is no target — score honestly across six dimensions using the rubric in your Skill.

Check whether the evidence manifest below actually, concretely supports the summary and findings you are given — a well-written summary that overstates what the manifest shows must be scored down on the relevant dimension(s), not given credit for confident prose.

Output format: your reply must be ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly this shape:
{
  "scores": {
    "official_sources": {"score": 0-20, "reason": "one sentence"},
    "fact_accuracy": {"score": 0-20, "reason": "one sentence"},
    "policy_timeline": {"score": 0-20, "reason": "one sentence"},
    "scope_exceptions": {"score": 0-15, "reason": "one sentence"},
    "data_reliability": {"score": 0-10, "reason": "one sentence"},
    "external_safety": {"score": 0-15, "reason": "one sentence"}
  }
}`;

export const RESEARCH_AUDIT_SYSTEM_PROMPT = `You are a marketing research quality auditor for LeoVisaAi, a UK immigration services marketing team.\n\n${EVIDENCE_RULES}\n\n${AUDIT_INSTRUCTIONS}`;

const scoreItemSchema = (max: number) => z.object({ score: z.number().min(0).max(max), reason: z.string() });

export const ResearchAuditClaimSchema = z.object({
  scores: z.object({
    official_sources: scoreItemSchema(20),
    fact_accuracy: scoreItemSchema(20),
    policy_timeline: scoreItemSchema(20),
    scope_exceptions: scoreItemSchema(15),
    data_reliability: scoreItemSchema(10),
    external_safety: scoreItemSchema(15),
  }),
});
export type ResearchAuditClaim = z.infer<typeof ResearchAuditClaimSchema>;

/**
 * The audit call's ENTIRE input boundary — Topic, the new content, and the
 * new evidence manifest. No previous score, no previous reasons, no
 * previous total, and no mention that a threshold like "80" exists
 * anywhere in this app — the auditor has no way to write toward a target
 * because it is never told one.
 */
export function buildResearchAuditUserPrompt(
  topic: { title: string; question: string; business: string; audience: string },
  content: { summary: string; keyFindings: readonly string[]; warnings: string; confidence: ResearchConfidence },
  manifestText: string,
): string {
  const lines = [
    `Topic title: ${topic.title}`,
    topic.question ? `Question this content should answer: ${topic.question}` : null,
    topic.business ? `Business / practice area: ${topic.business}` : null,
    topic.audience ? `Target audience: ${topic.audience}` : null,
    "",
    "=== 待审核的研究结果（这是唯一需要打分的对象）===",
    `Summary: ${content.summary}`,
    content.keyFindings.length > 0 ? `Key findings:\n${content.keyFindings.map((f) => `- ${f}`).join("\n")}` : "Key findings: (none)",
    content.warnings ? `Warnings: ${content.warnings}` : "Warnings: (none)",
    `Confidence: ${content.confidence}`,
    "",
    "=== 支持这份研究结果的证据（唯一可评估的证据来源）===",
    manifestText,
    "",
    "Score this research independently across the six dimensions, then reply with the JSON described in your instructions.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export interface OptimizedResearchPack extends GroundedResearchPack {
  suggestedTopicRevision: SuggestedTopicRevision | null;
}

/** Combines the content call's grounded output with the audit call's independently-produced score into the final pack shape research-actions.ts persists. */
export function combineAuditedOptimizationPack(content: OptimizedResearchContent, audit: ResearchAuditClaim): OptimizedResearchPack {
  const scoreBreakdown = normalizeScoreBreakdown(audit.scores);
  return {
    summary: content.summary,
    keyFindings: content.keyFindings,
    sources: content.sources,
    warnings: content.warnings,
    confidence: content.confidence,
    scoreBreakdown,
    scoreTotal: totalScore(scoreBreakdown),
    suggestedTopicRevision: content.suggestedTopicRevision,
  };
}
