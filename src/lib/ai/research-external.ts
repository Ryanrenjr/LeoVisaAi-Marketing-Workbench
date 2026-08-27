import { z } from "zod";
import type { SearchResult } from "../search/types";
import type { GroundedResearchPack, GroundedSource } from "./research-pack";
import { normalizeScoreBreakdown, totalScore } from "./research-pack";

/**
 * Pure prompt/schema/manifest/grounding logic for the external-search
 * Research path (Brave → Gemini) — no network, no "server-only" import,
 * fully unit-testable. Mirrors content-schemas.ts's label-manifest
 * pattern (S1/S2...) rather than research-pack.ts's self-reported-URL
 * pattern, because here the model receives pre-fetched evidence instead
 * of running its own search tool — structurally the same problem Content
 * Agent already solves. See docs/search-router.md "Search → Model
 * handoff".
 */

export const EXTERNAL_RESEARCH_SYSTEM_PROMPT = `You are a marketing research assistant for LeoVisaAi, a UK immigration services marketing team.

You do NOT have your own web search access for this task. You are given a manifest of REAL search results already retrieved by a separate search step — these are your ONLY evidence base. Treat them as your complete evidence boundary.

Hard rules:
- This is general marketing research to inform a piece of educational content. It is NOT individualized legal advice and NOT an assessment of any specific person's immigration case.
- Never fabricate a fact, statistic, policy detail, Immigration Rule paragraph, date, or URL. Reference evidence ONLY by its exact label from the manifest below (e.g. "S1") in source_references. Never invent a label or cite a label not present in the manifest.
- The manifest gives you titles and short snippets, NOT the full text of each page. You have not read any complete official document. Do not write as if you have — treat snippet-level evidence as partial, and be conservative about claims that would require the full page to verify.
- If the evidence doesn't clearly and sufficiently support a claim, do NOT state it. Instead note the gap in "warnings" (what's uncertain, what a human should verify against the full source, what requires expert review before publishing) and reflect it in your confidence level.
- Self-assess confidence honestly: HIGH requires multiple consistent primary-source (gov.uk / legislation.gov.uk / parliament.uk / official Home Office guidance) results clearly supporting the findings; MEDIUM means some support exists but with gaps, reliance on non-primary sources, or only snippet-level evidence for an important point; LOW means evidence is thin, conflicting, off-topic, or from non-primary sources only. When in doubt, choose the lower confidence level.
- Score your own research honestly across six dimensions, each with a max score and a one-sentence reason grounded in what the evidence manifest actually shows (see the Skill's full scoring rubric for what each dimension means) — a low score on a dimension is a legitimate, useful outcome, not a failure to hide.

Output format: your reply must be ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly this shape:
{
  "summary": "2-4 sentence overview of what the evidence found, for a content editor",
  "key_findings": ["short finding 1", "short finding 2", "..."],
  "source_references": ["S1", "S2", "..."],
  "warnings": "caveats, uncertainty, or anything a human should double-check (including anything only supported by a snippet rather than the full page) before this is used in content — empty string if none",
  "confidence": "LOW" | "MEDIUM" | "HIGH",
  "scores": {
    "official_sources": {"score": 0-20, "reason": "one sentence"},
    "fact_accuracy": {"score": 0-20, "reason": "one sentence"},
    "policy_timeline": {"score": 0-20, "reason": "one sentence"},
    "scope_exceptions": {"score": 0-15, "reason": "one sentence"},
    "data_reliability": {"score": 0-10, "reason": "one sentence"},
    "external_safety": {"score": 0-15, "reason": "one sentence"}
  }
}`;

const scoreItemSchema = (max: number) => z.object({ score: z.number().min(0).max(max), reason: z.string() });

export const ExternalResearchClaimSchema = z.object({
  summary: z.string(),
  key_findings: z.array(z.string()),
  source_references: z.array(z.string()),
  warnings: z.string(),
  confidence: z.enum(["LOW", "MEDIUM", "HIGH"]),
  scores: z.object({
    official_sources: scoreItemSchema(20),
    fact_accuracy: scoreItemSchema(20),
    policy_timeline: scoreItemSchema(20),
    scope_exceptions: scoreItemSchema(15),
    data_reliability: scoreItemSchema(10),
    external_safety: scoreItemSchema(15),
  }),
});
export type ExternalResearchClaim = z.infer<typeof ExternalResearchClaimSchema>;

export function buildExternalResearchUserPrompt(
  topic: { title: string; question: string; business: string; audience: string },
  queries: readonly string[],
  manifestText: string,
): string {
  const lines = [
    `Topic title: ${topic.title}`,
    topic.question ? `Question this content should answer: ${topic.question}` : null,
    topic.business ? `Business / practice area: ${topic.business}` : null,
    topic.audience ? `Target audience: ${topic.audience}` : null,
    "",
    `Search queries already run: ${queries.join(" | ")}`,
    "",
    "=== 已检索的真实搜索结果（唯一证据来源，仅可使用以下标签引用）===",
    manifestText,
    "",
    "Analyse this evidence and reply with the JSON research pack described in your instructions.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

export interface SearchManifestEntry {
  label: string;
  result: SearchResult;
}

export function buildSearchResultManifest(results: readonly SearchResult[]): {
  entries: SearchManifestEntry[];
  labelToResult: Map<string, SearchResult>;
  manifestText: string;
} {
  const entries = results.map((result, i) => ({ label: `S${i + 1}`, result }));
  const labelToResult = new Map(entries.map((e) => [e.label, e.result]));
  const manifestText = entries.length
    ? entries
        .map(
          (e) =>
            `[${e.label}] ${e.result.title} — ${e.result.url}${e.result.snippet ? ` — ${e.result.snippet}` : ""}`,
        )
        .join("\n")
    : "（本次搜索没有返回可用结果，内容生成时不得引用任何来源标签）";
  return { entries, labelToResult, manifestText };
}

/**
 * The anti-hallucination guarantee for the external-search path: any
 * label the model cites that isn't in the real manifest is dropped, never
 * resolved to a fabricated source — mirrors research-pack.ts's
 * groundSources / content-schemas.ts's groundContentSources exactly, just
 * keyed by label instead of by claimed URL (since here the model never
 * saw a real URL to begin with).
 */
export function buildExternalGroundedPack(
  claim: ExternalResearchClaim,
  labelToResult: Map<string, SearchResult>,
): GroundedResearchPack {
  const sources: GroundedSource[] = [];
  const seenUrls = new Set<string>();
  let droppedCount = 0;

  for (const raw of claim.source_references) {
    const result = labelToResult.get(raw.trim());
    if (result) {
      if (!seenUrls.has(result.url)) {
        sources.push({ title: result.title, url: result.url, note: result.snippet, pageAge: result.pageAge });
        seenUrls.add(result.url);
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
  notes.push(
    "（本次研究基于搜索结果标题与摘要生成，AI 未完整阅读原始网页全文；如涉及重要细节，请人工核实原始页面。）",
  );

  const scoreBreakdown = normalizeScoreBreakdown(claim.scores);

  return {
    summary: claim.summary,
    keyFindings: claim.key_findings,
    sources,
    warnings: notes.join(" "),
    confidence: claim.confidence,
    scoreBreakdown,
    scoreTotal: totalScore(scoreBreakdown),
  };
}
