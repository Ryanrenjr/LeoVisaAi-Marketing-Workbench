/**
 * Pure parsing/grounding logic for the Research Agent — no network calls,
 * no server-only imports, so it's directly unit-testable. The orchestration
 * (the actual Anthropic API call) lives in research-agent.ts.
 */

export type ResearchConfidence = "LOW" | "MEDIUM" | "HIGH";

const VALID_CONFIDENCE: readonly ResearchConfidence[] = ["LOW", "MEDIUM", "HIGH"];

export interface ResearchPackClaim {
  summary: string;
  key_findings: string[];
  sources: { title: string; url: string; note: string }[];
  warnings: string;
  confidence: ResearchConfidence;
  /** True when the model omitted or sent an invalid confidence value and we defaulted to LOW. */
  confidenceInferred: boolean;
}

export interface RealSearchResult {
  title: string;
  url: string;
  /** How long ago the page was published/updated, as reported by the search tool (e.g. "3 months ago"). */
  pageAge: string | null;
}

export interface GroundedSource {
  title: string;
  url: string;
  note: string;
  pageAge: string | null;
}

export interface GroundedResearchPack {
  summary: string;
  keyFindings: string[];
  sources: GroundedSource[];
  warnings: string;
  confidence: ResearchConfidence;
}

export const RESEARCH_SYSTEM_PROMPT = `You are a marketing research assistant for LeoVisaAi, a UK immigration services marketing team.

Your job: given a content topic, use the web_search tool to find REAL, currently-accessible public sources (government sites such as gov.uk, reputable news, established immigration-law explainer content) relevant to the topic, then write a short GENERAL marketing research brief for the content team.

Hard rules:
- This is general marketing research to inform a piece of educational content. It is NOT individualized legal advice and NOT an assessment of any specific person's immigration case. Never write as if addressing one particular person's situation.
- Never include, invent, or reference any real client name, case number, or personal identifying detail. Everything you write must stay at the level of general public information.
- Never fabricate a fact, statistic, or URL. Only cite sources that were actually returned by the web_search tool in this conversation — do not cite anything from memory or prior knowledge as if it were a search result.
- Self-assess your confidence honestly: HIGH means multiple reliable/official sources clearly and consistently support the findings; MEDIUM means some support exists but with gaps, ambiguity, or only one strong source; LOW means sources are thin, conflicting, outdated, or not clearly on-topic. When in doubt, choose the lower confidence level, and explain why in "warnings".

Output format: your FINAL reply (after you are done searching) must be ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly this shape:
{
  "summary": "2-4 sentence overview of what the research found, for a content editor",
  "key_findings": ["short finding 1", "short finding 2", "..."],
  "sources": [{"title": "source title", "url": "https://...", "note": "one sentence on what this source shows and why it's relevant"}],
  "warnings": "caveats, uncertainty, or anything a human should double-check before this is used in content — empty string if none",
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}`;

export function buildResearchUserPrompt(topic: {
  title: string;
  question: string;
  business: string;
  audience: string;
}): string {
  const lines = [
    `Topic title: ${topic.title}`,
    topic.question ? `Question this content should answer: ${topic.question}` : null,
    topic.business ? `Business / practice area: ${topic.business}` : null,
    topic.audience ? `Target audience: ${topic.audience}` : null,
    "",
    "Research this topic using web search, then reply with the JSON research pack described in your instructions.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function normalizeConfidence(value: unknown): { confidence: ResearchConfidence; inferred: boolean } {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase();
    if ((VALID_CONFIDENCE as readonly string[]).includes(upper)) {
      return { confidence: upper as ResearchConfidence, inferred: false };
    }
  }
  // Fail-safe default: an unreadable confidence claim is treated as LOW,
  // never silently upgraded — see docs/phase-3-5-plan.md "LOW-confidence handling".
  return { confidence: "LOW", inferred: true };
}

/** Parses the model's final text reply into a research pack claim. Throws on any invalid shape. */
export function parseResearchPackJson(raw: string): ResearchPackClaim {
  const jsonText = stripCodeFence(raw);

  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error("模型返回内容不是有效的 JSON");
  }

  if (typeof data !== "object" || data === null) {
    throw new Error("模型返回内容格式不正确");
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.summary !== "string" || !obj.summary.trim()) {
    throw new Error("研究结果缺少 summary 字段");
  }
  if (!Array.isArray(obj.key_findings) || !obj.key_findings.every((f) => typeof f === "string")) {
    throw new Error("研究结果缺少有效的 key_findings 字段");
  }
  if (!Array.isArray(obj.sources)) {
    throw new Error("研究结果缺少 sources 字段");
  }
  const sources = obj.sources.map((s, i) => {
    if (
      typeof s !== "object" ||
      s === null ||
      typeof (s as Record<string, unknown>).title !== "string" ||
      typeof (s as Record<string, unknown>).url !== "string"
    ) {
      throw new Error(`sources[${i}] 缺少 title 或 url`);
    }
    const rec = s as Record<string, unknown>;
    return {
      title: rec.title as string,
      url: rec.url as string,
      note: typeof rec.note === "string" ? rec.note : "",
    };
  });

  const { confidence, inferred } = normalizeConfidence(obj.confidence);

  return {
    summary: obj.summary,
    key_findings: obj.key_findings as string[],
    sources,
    warnings: typeof obj.warnings === "string" ? obj.warnings : "",
    confidence,
    confidenceInferred: inferred,
  };
}

function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * The anti-hallucination guarantee: drops every claimed source that isn't
 * backed by a URL the web_search tool actually returned in this response,
 * and attaches that real result's page_age (the model never reports this
 * itself — it isn't part of its claim, only of the tool's real output).
 * A model that invents a citation gets it silently removed here — it
 * never reaches the saved Research Pack.
 */
export function groundSources(
  claimed: { title: string; url: string; note: string }[],
  realResults: RealSearchResult[],
): { sources: GroundedSource[]; droppedCount: number } {
  const realByUrl = new Map(realResults.map((r) => [normalizeUrl(r.url), r]));
  const sources: GroundedSource[] = [];
  for (const s of claimed) {
    const real = realByUrl.get(normalizeUrl(s.url));
    if (real) sources.push({ title: s.title, url: s.url, note: s.note, pageAge: real.pageAge });
  }
  return { sources, droppedCount: claimed.length - sources.length };
}

export function buildGroundedPack(
  claim: ResearchPackClaim,
  realResults: RealSearchResult[],
): GroundedResearchPack {
  const { sources, droppedCount } = groundSources(claim.sources, realResults);

  const notes: string[] = [];
  if (claim.warnings) notes.push(claim.warnings);
  if (droppedCount > 0) {
    notes.push(`（系统已自动移除 ${droppedCount} 条未经真实网络搜索验证的来源，仅保留可核实来源）`);
  }
  if (claim.confidenceInferred) {
    notes.push("（模型未提供有效的置信度评估，系统按 LOW 处理，请谨慎核实）");
  }

  return {
    summary: claim.summary,
    keyFindings: claim.key_findings,
    sources,
    warnings: notes.join(" "),
    confidence: claim.confidence,
  };
}
