import { z } from "zod";
import type { ContentPillar } from "../types";

/**
 * Pure schema/prompt/query logic for Employee A's "今日选题搜索" — no
 * network calls, no "server-only" import, mirrors research-queries.ts /
 * research-external.ts's split from router.ts. Live by explicit user
 * instruction ("全都做" — see CLAUDE.md history).
 *
 * Candidates are NEVER written to the topics table automatically — this
 * module only produces suggestions; a person reviews each one and clicks
 * "加入选题库" (src/app/team/planner/actions.ts addDiscoveredTopic), which
 * goes through the exact same createTopic path as manual topic creation.
 */

const CONTENT_PILLARS: readonly ContentPillar[] = [
  "policy_update",
  "myth_busting",
  "how_to",
  "case_study",
  "news",
];

export const TopicCandidateSchema = z.object({
  title: z.string(),
  question: z.string(),
  business: z.string(),
  audience: z.string(),
  content_pillar: z.enum(CONTENT_PILLARS as [ContentPillar, ...ContentPillar[]]).nullable(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]),
  source_label: z.string(),
  reason: z.string(),
});
export type TopicCandidate = z.infer<typeof TopicCandidateSchema>;

export const TopicDiscoveryResultSchema = z.object({
  candidates: z.array(TopicCandidateSchema).max(6),
});
export type TopicDiscoveryResult = z.infer<typeof TopicDiscoveryResultSchema>;

/** Fixed, deterministic — not LLM-generated — mirrors research-queries.ts buildResearchQueries. */
export function buildDiscoveryQueries(now: Date = new Date()): string[] {
  const monthYear = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return [
    `UK immigration rules changes news ${monthYear}`,
    `Home Office visa policy announcement ${monthYear}`,
    `UK Immigration Rules statement of changes ${monthYear}`,
  ];
}

export interface DiscoverySearchResult {
  label: string;
  title: string;
  url: string;
  snippet: string;
  publishedDate: string | null;
}

export function buildDiscoveryManifest(results: DiscoverySearchResult[]): string {
  if (results.length === 0) return "（本次没有检索到任何新闻结果，请勿编造任何选题候选）";
  return results
    .map(
      (r) =>
        `[${r.label}] ${r.title}${r.publishedDate ? `（${r.publishedDate}）` : ""} — ${r.url}\n${r.snippet}`,
    )
    .join("\n\n");
}

export const TOPIC_DISCOVERY_SYSTEM_PROMPT = `You help a UK immigration services marketing team (LeoVisaAi) find today's most worthwhile content topics from real recent news.

You are given a numbered list of real search results about UK immigration policy/news below. Propose up to 6 topic candidates, each grounded in ONE of the numbered results — set source_label to that result's exact label (e.g. "N1"). Never invent a topic that isn't reflected in the given search results, and never invent a source_label that isn't in the list.

For each candidate:
- title: a short, specific working title for the content piece (Chinese).
- question: the concrete question this content answers for a reader (Chinese), e.g. "老永居离境超过2年，身份还在吗？" style — specific, not generic.
- business: which immigration matter this relates to (Chinese, short, e.g. "永居 / ILR", "学生签证", "工作签证").
- audience: who this is for (Chinese, short).
- content_pillar: one of policy_update / myth_busting / how_to / case_study / news — whichever fits best, or null if genuinely unclear.
- priority: HIGH if this is time-sensitive or affects many people, MEDIUM for solid but not urgent, LOW for minor/niche.
- reason: one Chinese sentence explaining why this is worth covering now, referencing what changed.

If none of the search results are relevant to UK immigration content marketing, return an empty candidates array rather than forcing irrelevant suggestions.

Output only the structured candidates requested — no extra commentary outside the schema.`;

export function buildTopicDiscoveryUserPrompt(manifestText: string): string {
  return `=== 近期新闻检索结果 ===\n${manifestText}\n\nBased only on the above, propose today's topic candidates now.`;
}
