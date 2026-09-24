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

## Evidence type — read the "Evidence type" line on every manifest entry

Each entry is one of two types, and they carry different weight:

- **OFFICIAL_EXTRACT** — real content actually retrieved from that official page (may be the full text, or a relevance-ranked excerpt of it — never assume it's necessarily the complete document). You may treat this as read and reason from it directly, but only about what is actually shown in the extract. Do not claim a section, exception, or detail exists if it isn't present in what you were given.
- **SEARCH_SNIPPET** — a short search-engine snippet only, not the page itself. Keep treating this as partial: don't treat it as the full page, don't infer hidden exceptions, don't invent a paragraph number, and lower confidence for any important claim that rests only on a snippet.

## Evidence hierarchy — when sources conflict, higher wins

1. Legislation / Immigration Rules / other official statutory text
2. Home Office caseworker guidance
3. GOV.UK official public guidance
4. Parliament or other official material
5. Reputable professional secondary material (e.g. law firm commentary)
6. Commercial immigration websites
7. Social media / forums

An OFFICIAL_EXTRACT from an official source always outweighs a SEARCH_SNIPPET (or even another OFFICIAL_EXTRACT) from a lower-ranked source on the same question — do not let a commercial immigration website's explanation override or dilute what an official extract directly shows. Secondary/commercial sources still have a real job: spotting genuine user confusion, common misconceptions, or real ambiguity worth addressing — they just can't override a clear official answer.

- If the evidence doesn't clearly and sufficiently support a claim, do NOT state it. Instead note the gap in "warnings" (what's uncertain, what a human should verify against the full source, what requires expert review before publishing) and reflect it in your confidence level.
- Self-assess confidence based on evidence LEVEL, not a fixed assumption about what this system can retrieve: multiple consistent OFFICIAL_EXTRACT entries from primary sources (gov.uk / legislation.gov.uk / parliament.uk / official Home Office guidance) directly supporting the findings can justify HIGH confidence even with few secondary sources. Relying only on SEARCH_SNIPPET-level evidence should stay conservative — MEDIUM at best for anything beyond a well-established basic fact, LOW where evidence is thin, conflicting, off-topic, or non-primary. Do not mechanically cap confidence at MEDIUM/LOW out of habit — base it purely on what this manifest actually shows this time.
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

/** OFFICIAL_EXTRACT = real content actually retrieved from that page (Round 4 — see src/lib/search/extraction.ts). SEARCH_SNIPPET = only ever had the search engine's short snippet. Never conflate the two — see EXTERNAL_RESEARCH_SYSTEM_PROMPT's "Evidence type" section. */
export type EvidenceType = "OFFICIAL_EXTRACT" | "SEARCH_SNIPPET";

export interface SearchManifestEntry {
  label: string;
  result: SearchResult;
  evidenceType: EvidenceType;
  /** Only set when evidenceType is OFFICIAL_EXTRACT. */
  extractedContent: string | null;
}

function formatManifestEntry(entry: SearchManifestEntry): string {
  const { label, result, evidenceType, extractedContent } = entry;
  const lines = [
    `[${label}] ${result.title}`,
    `URL: ${result.url}`,
    result.publisher ? `Publisher: ${result.publisher}` : null,
    `Evidence type: ${evidenceType}`,
    evidenceType === "OFFICIAL_EXTRACT"
      ? `Extracted page content (relevance-ranked excerpt from the real page — not necessarily the complete document):\n${extractedContent}`
      : `Search snippet:\n${result.snippet || "(no snippet provided)"}`,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}

/**
 * `extractedByUrl` carries any real page content Round 4's official-source
 * extraction step (src/lib/search/extraction.ts) retrieved, keyed by the
 * exact URL it was extracted from. A result whose URL isn't in the map
 * (extraction wasn't attempted for it, or it failed) stays a
 * SEARCH_SNIPPET — never silently upgraded.
 */
export function buildSearchResultManifest(
  results: readonly SearchResult[],
  extractedByUrl: ReadonlyMap<string, string> = new Map(),
): {
  entries: SearchManifestEntry[];
  labelToResult: Map<string, SearchResult>;
  manifestText: string;
} {
  const entries: SearchManifestEntry[] = results.map((result, i) => {
    const extractedContent = extractedByUrl.get(result.url) ?? null;
    return {
      label: `S${i + 1}`,
      result,
      evidenceType: extractedContent ? "OFFICIAL_EXTRACT" : "SEARCH_SNIPPET",
      extractedContent,
    };
  });
  const labelToResult = new Map(entries.map((e) => [e.label, e.result]));
  const manifestText = entries.length
    ? entries.map((e) => formatManifestEntry(e)).join("\n\n")
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
/** How much real page content Round 4's official-source extraction actually retrieved for this run — drives buildExternalGroundedPack's disclosure note so it reflects real retrieval state instead of a fixed "snippet-only" claim. Defaults to "nothing was extracted" so every existing caller/test that doesn't pass this keeps the old (still-accurate for that case) behavior. */
export interface RetrievalMeta {
  officialExtractCount: number;
  failedExtractionCount: number;
}

function buildRetrievalDisclosure(meta: RetrievalMeta): string[] {
  const notes: string[] = [];
  notes.push(
    meta.officialExtractCount > 0
      ? `（本次研究已读取 ${meta.officialExtractCount} 个官方来源中与本题相关的提取内容；其余来源仍可能仅为搜索摘要，如涉及重要细节，请人工核实原始页面。）`
      : "（本次研究仅基于搜索结果标题与摘要，未读取官方页面正文；如涉及重要细节，请人工核实原始页面。）",
  );
  if (meta.failedExtractionCount > 0) {
    notes.push(
      `（其中 ${meta.failedExtractionCount} 个官方来源尝试读取正文失败，已改用搜索摘要继续研究，不影响本次结果生成。）`,
    );
  }
  return notes;
}

export function buildExternalGroundedPack(
  claim: ExternalResearchClaim,
  labelToResult: Map<string, SearchResult>,
  retrievalMeta: RetrievalMeta = { officialExtractCount: 0, failedExtractionCount: 0 },
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
  notes.push(...buildRetrievalDisclosure(retrievalMeta));

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
