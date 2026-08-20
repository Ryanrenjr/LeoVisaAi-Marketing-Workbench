import { z } from "zod";
import { scanForbiddenPhrases } from "./content-schemas";
import type { ResearchConfidence } from "../types";

/**
 * Pure schema/prompt logic for Employee D (合规审核员) — no network calls,
 * no "server-only" import, mirrors content-schemas.ts's split from
 * content-agent.ts. See docs/security-boundaries.md "AI usage" and
 * CLAUDE.md — Compliance went live by explicit live user instruction,
 * overriding this repo's earlier "not implemented" notes.
 *
 * Compliance NEVER issues a "content is compliant / approved" verdict —
 * only findings for a human to review, same evidentiary posture as
 * expert_review_notes elsewhere in this app. It re-checks against the
 * SAME approved Research Pack the content was generated from, plus a
 * fixed, code-level forbidden-phrase scan (not just a prompted rule).
 */

export const ComplianceFindingSchema = z.object({
  issue_type: z.enum([
    "unsupported_claim",
    "individualized_advice",
    "hype_language",
    "outdated_or_unverifiable",
    "other",
  ]),
  quote: z.string(),
  explanation: z.string(),
});
export type ComplianceFinding = z.infer<typeof ComplianceFindingSchema>;

export const ComplianceReviewSchema = z.object({
  overall_risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  findings: z.array(ComplianceFindingSchema),
  summary: z.string(),
});
export type ComplianceReview = z.infer<typeof ComplianceReviewSchema>;

export const COMPLIANCE_SYSTEM_PROMPT = `You are a second, independent reviewer for LeoVisaAi, a UK immigration services marketing content team. You did NOT write the content below — your only job is to re-check it, the same way a careful editor double-checks a colleague's draft before it goes out.

You are NOT approving or certifying the content as "compliant" — that phrase does not exist in your vocabulary. Your job is narrower and more useful: surface specific things a human (Leo) should look at again before publishing. If you find nothing, say so plainly — do not invent a finding to seem thorough.

Check for exactly these four categories, and ONLY these:
1. unsupported_claim — a specific immigration rule, policy detail, deadline, or number in the content that is NOT traceable to the Approved Research Pack given below. Quote the exact sentence.
2. individualized_advice — language that reads as advice or an eligibility determination for a specific individual reader ("你符合条件", "你一定能通过", "你的情况可以...") rather than general public information. This content must stay general-audience marketing content, never a personal case assessment.
3. hype_language — fear-based or artificial-urgency phrasing (e.g. "英国彻底变天" / "重磅" / "赶紧申请" / "窗口马上关闭" / "错过就没机会" or similar) that isn't genuinely supported by a real stated deadline in the Research Pack.
4. outdated_or_unverifiable — a claim that depends on information likely to change (rates, processing times, specific dates) where the Research Pack's own warnings or confidence level suggest it may already be stale.

For each finding, quote the exact text and explain briefly why it's flagged. Set overall_risk based on severity: HIGH if any unsupported_claim or individualized_advice is found, MEDIUM if only hype_language/outdated_or_unverifiable, LOW if nothing found. summary is 1-2 plain sentences for Leo, in Chinese.

Output only the structured findings requested — no extra commentary outside the schema.`;

export function buildComplianceContextBlock(
  content: {
    platform: string;
    textForReview: string;
  },
  researchPack: {
    summary: string;
    key_findings: string[];
    warnings: string;
    confidence: ResearchConfidence;
  },
): string {
  const lines = [
    `平台：${content.platform}`,
    "",
    "=== 已批准的研究成果（唯一证据来源）===",
    `研究摘要：${researchPack.summary}`,
    researchPack.key_findings.length > 0
      ? `关键发现：\n${researchPack.key_findings.map((f) => `- ${f}`).join("\n")}`
      : null,
    researchPack.warnings ? `研究注意事项：${researchPack.warnings}` : null,
    `研究置信度：${researchPack.confidence}`,
    "",
    "=== 待复核的内容 ===",
    content.textForReview,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

/**
 * Deterministic safety net, mirroring buildForbiddenPhraseNotes in
 * content-schemas.ts — runs regardless of what the model itself reports,
 * so a forbidden phrase is never missed because the model didn't flag it.
 */
export function scanTextForComplianceFindings(text: string): ComplianceFinding[] {
  return scanForbiddenPhrases(text).map((phrase) => ({
    issue_type: "hype_language" as const,
    quote: phrase,
    explanation: `代码级扫描命中固定的风险用语列表："${phrase}"。`,
  }));
}

/** Merge model-reported findings with the deterministic scan, de-duplicated by exact quote. */
export function mergeComplianceFindings(
  modelFindings: ComplianceFinding[],
  scannedFindings: ComplianceFinding[],
): ComplianceFinding[] {
  const seen = new Set(modelFindings.map((f) => f.quote));
  const extra = scannedFindings.filter((f) => !seen.has(f.quote));
  return [...modelFindings, ...extra];
}

export function overallRiskFor(findings: ComplianceFinding[], modelRisk: ComplianceReview["overall_risk"]): ComplianceReview["overall_risk"] {
  if (findings.some((f) => f.issue_type === "unsupported_claim" || f.issue_type === "individualized_advice")) {
    return "HIGH";
  }
  if (findings.length > 0 && modelRisk === "LOW") return "MEDIUM";
  return modelRisk;
}
