import { z } from "zod";
import { PRIMARY_SOURCE_DOMAINS } from "./research-queries";
import type { ResearchSearchQuery } from "../search/types";

/**
 * Round 4C — Research Query Planner: pure schema/prompt/conversion logic,
 * no network, no "server-only" import, fully unit-testable — mirrors
 * research-queries.ts / research-external.ts's separation from router.ts.
 *
 * Why this exists: Round 4B's deterministic buildResearchSearchQueries()
 * combined with Tavily's `include_domains_mode: "filter"` correctly
 * restricts search to official domains, but a real production case
 * (Returning Resident) showed the Chinese-language question itself still
 * failing to rank the actually relevant GOV.UK page within that
 * domain-restricted set — the same page was directly findable with a
 * well-phrased English query. This module is a narrow AI call whose ONLY
 * job is rewriting the research question into English retrieval queries
 * — it is not a researcher: it never answers the question, never cites
 * evidence, never produces a Research Pack. See docs/search-router.md
 * "Research Query Planner".
 *
 * Deliberately does NOT use buildSkillPrompt("researcher", ...) — the
 * planner is infrastructure, not the digital-employee-facing B｜政策研究员
 * Skill. It gets its own narrow system prompt only.
 */

export const ResearchQueryPlanSchema = z.object({
  official_query: z.string().min(1).max(250),
  legal_query: z.string().min(1).max(250),
  general_query: z.string().min(1).max(250),
});
export type ResearchQueryPlan = z.infer<typeof ResearchQueryPlanSchema>;

export const RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT = `You are a search-query planner, not a legal researcher. Your only job is to turn a Chinese (or bilingual) UK immigration research question into three high-quality ENGLISH web-search queries, so a separate search step can find real UK official (GOV.UK / Home Office / Immigration Rules / legislation.gov.uk / Parliament) and secondary sources. You do not research, browse, or answer anything yourself.

Rules:
1. Output English queries only — all three fields must be in English, regardless of what language the input is in.
2. Preserve the actual question, not just keywords. Identify the real relationship the input is built on — comparison, causation, eligibility, absence/time limit, exception, status consequence, fee/cost logic, application requirement, etc. — and keep it in the query. Do not flatten a specific question into a generic topic keyword.
3. Use likely official UK immigration terminology where you can reasonably infer it from the input (e.g. 永居 → "indefinite leave to remain" / "settlement", 工签 → "Skilled Worker", 入籍 → "naturalisation") — from your own knowledge of the domain, not from a lookup table you're given.
4. Do NOT answer the research question. Never output a legal conclusion, explanation, recommendation, "safe to say," or "do not say" — only the three search queries.
5. Do NOT invent Immigration Rules paragraph numbers, appendix letters, or article numbers that weren't explicitly given in the input.
6. Do NOT treat the user's own stated premise as verified fact. If the input asserts a specific figure or claim (e.g. "processing cost is only £310"), treat it as the direction to investigate, not as something already true — you may still use it in a query (e.g. "Home Office ILR application fee processing cost"), but don't need it confirmed to write the query.
7. Do NOT output any URL. Real URLs come from the search step, never from you.
8. Keep each query concise — roughly 5-18 English words, like a real search query, not a sentence or paragraph. Don't sacrifice search quality just to hit a word count.

The three queries have different jobs:
- official_query: aimed at finding a general GOV.UK / Home Office official explanation page. Combine the core question with the most likely official terminology. Do not include a domain name (e.g. "gov.uk") in the query text — domain restriction is handled separately by the search step.
- legal_query: aimed at finding Home Office caseworker guidance, Immigration Rules, or other statutory/official legal material — lean more toward legal/policy/guidance phrasing than official_query. Don't mechanically force the literal phrase "Immigration Rules" into every query if a different official phrasing (e.g. "Home Office guidance", "policy guidance") fits the topic more naturally — use whatever phrasing is most natural for this specific topic.
- general_query: aimed at general web search for professional commentary, common misunderstandings, or secondary explanation — still about the same research question, not a different topic.

Output format: your reply must be ONLY a single JSON object — no markdown code fences, no prose before or after it — matching exactly this shape:
{
  "official_query": "...",
  "legal_query": "...",
  "general_query": "..."
}`;

export function buildResearchQueryPlannerUserPrompt(topic: {
  title: string;
  question: string;
  business: string;
  audience: string;
}): string {
  const lines = [
    `Title: ${topic.title}`,
    topic.question ? `Research question: ${topic.question}` : null,
    topic.business ? `Business / practice area: ${topic.business}` : null,
    topic.audience ? `Audience: ${topic.audience}` : null,
    "",
    "Generate the three search queries now.",
  ].filter((line): line is string => line !== null);
  return lines.join("\n");
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Deterministic cleanup only — trim + collapse whitespace. Never keyword-rewriting, never a Chinese/English dictionary, never regex term injection — that's the model's job, not code's. */
export function cleanResearchQueryPlan(plan: ResearchQueryPlan): ResearchQueryPlan {
  return {
    official_query: collapseWhitespace(plan.official_query),
    legal_query: collapseWhitespace(plan.legal_query),
    general_query: collapseWhitespace(plan.general_query),
  };
}

/**
 * Converts a validated plan into Round 4B's ResearchSearchQuery[] shape —
 * same 3-search structure as buildResearchSearchQueries (official +
 * legal search restricted to PRIMARY_SOURCE_DOMAINS, general search
 * unrestricted), just fed by the planner's English queries instead of
 * the deterministic Chinese-question template.
 */
export function planToResearchSearchQueries(plan: ResearchQueryPlan): ResearchSearchQuery[] {
  const cleaned = cleanResearchQueryPlan(plan);
  return [
    { query: cleaned.official_query, includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_PRIMARY" },
    { query: cleaned.legal_query, includeDomains: PRIMARY_SOURCE_DOMAINS, lane: "OFFICIAL_LEGAL" },
    { query: cleaned.general_query, lane: "GENERAL" },
  ];
}
