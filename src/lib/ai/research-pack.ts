/**
 * Pure parsing/grounding logic for the Research Agent — no network calls,
 * no server-only imports, so it's directly unit-testable. The orchestration
 * (the actual Anthropic API call) lives in research-agent.ts.
 */
import type { ResearchScoreBreakdown, ResearchScoreItem } from "../types";

export type ResearchConfidence = "LOW" | "MEDIUM" | "HIGH";

const VALID_CONFIDENCE: readonly ResearchConfidence[] = ["LOW", "MEDIUM", "HIGH"];

/**
 * B｜政策研究员's six-dimension score (docs/digital-employee-skills.md
 * "B｜政策研究员" §10) — fixed point allocation, defined once here so the
 * prompt, the parser, and the fail-safe defaults below can't drift apart.
 */
export const RESEARCH_SCORE_DIMENSIONS = [
  { key: "official_sources", field: "officialSources", max: 20, label: "官方来源可靠度" },
  { key: "fact_accuracy", field: "factAccuracy", max: 20, label: "事实准确度" },
  { key: "policy_timeline", field: "policyTimeline", max: 20, label: "政策状态与时间线" },
  { key: "scope_exceptions", field: "scopeExceptions", max: 15, label: "适用范围与例外" },
  { key: "data_reliability", field: "dataReliability", max: 10, label: "数据与数字可信度" },
  { key: "external_safety", field: "externalSafety", max: 15, label: "对外表达安全度" },
] as const satisfies readonly { key: string; field: keyof ResearchScoreBreakdown; max: number; label: string }[];

/**
 * A missing/invalid/out-of-range score for a dimension is never silently
 * trusted — defaults to 0 with an explicit reason, same fail-safe
 * philosophy as normalizeConfidence below (an unreadable claim is treated
 * as the worst case, not a passing one).
 */
function normalizeScoreItem(raw: unknown, max: number): ResearchScoreItem {
  if (typeof raw === "object" && raw !== null) {
    const rec = raw as Record<string, unknown>;
    const score = typeof rec.score === "number" && Number.isFinite(rec.score) ? rec.score : null;
    if (score !== null) {
      return {
        score: Math.min(Math.max(Math.round(score), 0), max),
        max,
        reason: typeof rec.reason === "string" ? rec.reason : "",
      };
    }
  }
  return { score: 0, max, reason: "（模型未提供有效打分，按 0 分处理，请人工核实）" };
}

export function normalizeScoreBreakdown(raw: unknown): ResearchScoreBreakdown {
  const rec = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const breakdown = {} as ResearchScoreBreakdown;
  for (const dim of RESEARCH_SCORE_DIMENSIONS) {
    breakdown[dim.field] = normalizeScoreItem(rec[dim.key], dim.max);
  }
  return breakdown;
}

export function totalScore(breakdown: ResearchScoreBreakdown): number {
  return RESEARCH_SCORE_DIMENSIONS.reduce((sum, dim) => sum + breakdown[dim.field].score, 0);
}

/** True only when every dimension is actually present — an old pack (predating this feature) has `score_breakdown: {}` from the DB default, not null, so this is the one place that distinguishes "really scored" from "just an empty default" everywhere a caller needs to decide whether to show the score board at all. */
export function hasScoreData(breakdown: ResearchScoreBreakdown | null | undefined): breakdown is ResearchScoreBreakdown {
  if (!breakdown) return false;
  return RESEARCH_SCORE_DIMENSIONS.every((dim) => breakdown[dim.field] !== undefined);
}

export interface ResearchPackClaim {
  summary: string;
  key_findings: string[];
  sources: { title: string; url: string; note: string }[];
  warnings: string;
  confidence: ResearchConfidence;
  /** True when the model omitted or sent an invalid confidence value and we defaulted to LOW. */
  confidenceInferred: boolean;
  scoreBreakdown: ResearchScoreBreakdown;
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
  scoreBreakdown: ResearchScoreBreakdown;
  scoreTotal: number;
}

export const RESEARCH_SYSTEM_PROMPT = `You are a marketing research assistant for LeoVisaAi, a UK immigration services marketing team.

Your job: given a content topic, use the web_search tool to find REAL, currently-accessible public sources (government sites such as gov.uk, reputable news, established immigration-law explainer content) relevant to the topic, then write a short GENERAL marketing research brief for the content team.

Hard rules:
- This is general marketing research to inform a piece of educational content. It is NOT individualized legal advice and NOT an assessment of any specific person's immigration case. Never write as if addressing one particular person's situation.
- Never include, invent, or reference any real client name, case number, or personal identifying detail. Everything you write must stay at the level of general public information.
- Never fabricate a fact, statistic, or URL. Only cite sources that were actually returned by the web_search tool in this conversation — do not cite anything from memory or prior knowledge as if it were a search result.
- Self-assess your confidence honestly: HIGH means multiple reliable/official sources clearly and consistently support the findings; MEDIUM means some support exists but with gaps, ambiguity, or only one strong source; LOW means sources are thin, conflicting, outdated, or not clearly on-topic. When in doubt, choose the lower confidence level, and explain why in "warnings".
- Score your own research honestly across six dimensions, each with a max score and a one-sentence reason grounded in what you actually found (see the Skill's full scoring rubric for what each dimension means) — a low score on a dimension is a legitimate, useful outcome, not a failure to hide.

Output format: your FINAL reply (after you are done searching) must be ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly this shape:
{
  "summary": "2-4 sentence overview of what the research found, for a content editor",
  "key_findings": ["short finding 1", "short finding 2", "..."],
  "sources": [{"title": "source title", "url": "https://...", "note": "one sentence on what this source shows and why it's relevant"}],
  "warnings": "caveats, uncertainty, or anything a human should double-check before this is used in content — empty string if none",
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
    scoreBreakdown: normalizeScoreBreakdown(obj.scores),
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
    scoreBreakdown: claim.scoreBreakdown,
    scoreTotal: totalScore(claim.scoreBreakdown),
  };
}
