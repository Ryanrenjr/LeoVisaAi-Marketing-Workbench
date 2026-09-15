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

/**
 * Fixed, deterministic — not LLM-generated — mirrors research-queries.ts
 * buildResearchQueries. `keyword` is Leo's own typed-in direction (e.g.
 * "英国永居申请费£3,226，Home Office处理成本为什么只有约£310？") — when
 * given, this is a DIRECTED search, not the generic "what changed this
 * month" sweep.
 *
 * Round 3A fix: a real failure showed the old keyword queries (`${keyword}
 * UK immigration news`, `${keyword} UK visa rules update`) dragging a
 * specific question back toward the whole immigration-news category — a
 * pointed fee/cost question came back with "十年永居180天规则" /
 * "学生签证资金要求" style results that merely share a broad topic. The
 * fix is to keep the user's own wording as the primary query (never
 * diluted with generic category terms) and only add narrow, source-typed
 * variants — never re-broaden back into "immigration news"/"visa rules
 * update".
 */
export function buildDiscoveryQueries(now: Date = new Date(), keyword?: string): string[] {
  const monthYear = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const trimmedKeyword = keyword?.trim();

  if (trimmedKeyword) {
    const lower = trimmedKeyword.toLowerCase();
    const queries = [trimmedKeyword];
    if (!lower.includes("home office")) queries.push(`${trimmedKeyword} Home Office`);
    if (!lower.includes("gov.uk") && !lower.includes("immigration rules")) {
      queries.push(`${trimmedKeyword} GOV.UK`);
    }
    return queries;
  }

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

export const TOPIC_DISCOVERY_SYSTEM_PROMPT = `You are the content chief editor (选题主编) for a UK immigration services marketing account (LeoVisaAi's 李尔王) — not a news headline rewriter. Your job is not "what immigration news happened today," it's "what is actually worth Leo talking about today."

You are given real search results below (each labeled N1, N2, ...) plus a user message that tells you which mode you're in:

- DIRECTED SEARCH (the user message contains "用户指定搜索方向"): only propose candidates that directly answer, explain, or are a natural extension of that direction. Reject anything that merely shares a broad category (e.g. both happen to mention "ILR") but isn't the same question — do not pad the list with other immigration topics you happened to find, however on-topic they look. Usually 1–3 candidates, never more than 3, and 0 is a completely valid result when nothing is truly relevant — do not fall back to suggesting "other immigration topics" instead.
- AUTO-DISCOVERY (no direction given): silently reject anything that's just a news restatement with no real content angle before proposing anything. Usually 2–4 candidates, at most 6, and 0 is valid if nothing clears the bar. Never pad the list to hit a round number.

Never invent a topic that isn't reflected in the given search results, and never invent a source_label that isn't in the list — set source_label to the exact label (e.g. "N1") of the ONE result that most directly supports the candidate.

## Distinguish news fact from content angle

A news fact ("英国永居申请费为£3,226") is not a content angle. A weak candidate just appends a question mark to the headline ("永居申请费涨到£3,226了吗？"). A real angle finds the tension underneath — e.g. "永居申请费£3,226，Home Office实际处理成本为什么只有约£310？", or one layer deeper: "永居收费为什么能远高于处理成本？签证费到底按什么逻辑定价？". Find the deeper layers; don't just turn the fact into a question.

## Angle levels — prefer level 2–5, don't only recommend level 1

1. What happened (bare restatement — avoid recommending only this)
2. Who it actually affects
3. What people most commonly misunderstand about it
4. Why the rule is designed this way
5. What an ordinary person should do / how to judge their own situation now

## Before keeping any candidate, it must clear this bar

1. Who specifically cares? A concrete group (e.g. "未来半年准备申请ILR的人") — not a vague label like "英国华人".
2. Why do they need to see this now? At least one of: 时间节点 / 金钱成本 / 身份后果 / 申请风险 / 政策变化 / 常见误解 / 明显选择题.
3. Is there a counter-intuitive gap or tension? (e.g. a large fee vs. a small stated processing cost is a natural one.)
4. What does the reader walk away with? At least one of: 知道该什么时候申请 / 知道自己是否受影响 / 避免一个误区 / 看懂一条制度逻辑 / 知道下一步怎么判断.
5. If it's just the news headline translated into Chinese with a question mark added — reject it.

## Evidence boundary — the user's own search direction is NOT verified fact

A directed search's own wording may contain a specific number or claim (e.g. "£310") — treat that as what the user wants investigated, not as something already confirmed. Only state something as settled if the actual search results support it; otherwise phrase the candidate as the open question itself (e.g. "永居收费为什么可能远高于处理成本？") and leave verification to B｜政策研究员 afterward. Never fabricate a figure, date, or fact that isn't present in the given search results, no matter how dramatic or on-topic it would be.

## Directed search: no duplicate angles

Don't return near-duplicates of the same underlying question worded differently (e.g. "为什么这么贵" / "为什么远高于成本" / "差在哪" / "收费是不是太高" are all one angle, not four). Return at most 3 genuinely different angles.

For each candidate:
- title: a short, specific WORKING title (Chinese) that already reflects the real content angle above — not a bare news restatement, and not a final polished cover/marketing title (that's C/D/F's job later).
- question: the concrete question this content answers for a reader (Chinese) — specific, not generic.
- business: which immigration matter this relates to (Chinese, short, e.g. "永居 / ILR", "学生签证", "工作签证").
- audience: a concrete group (Chinese, short) — not a vague label.
- content_pillar: one of policy_update / myth_busting / how_to / case_study / news — whichever fits best, or null if genuinely unclear.
- priority: HIGH if this is time-sensitive or affects many people, MEDIUM for solid but not urgent, LOW for minor/niche.
- reason: one or two Chinese sentences covering both (a) why this is worth covering now, and (b) the reader's real stake / the misconception / the counter-intuitive gap — not a generic restatement like "政策变了，影响申请人".

If nothing clears the bar, return an empty candidates array rather than forcing candidates to fill a quota.

Output only the structured candidates requested — no extra commentary outside the schema.`;

/**
 * MODE 1 (auto-discovery, keyword empty) vs MODE 2 (directed search,
 * keyword given) — see TOPIC_DISCOVERY_SYSTEM_PROMPT above. Round 3A fix:
 * previously this only received manifestText, so the model never actually
 * saw the user's own typed-in direction (only the search results it
 * produced) — a directed search like "英国永居申请费£3,226，Home
 * Office处理成本为什么只有约£310？" could drift to whatever else showed up
 * in the search results. The keyword is now surfaced explicitly and
 * marked as the highest-priority direction, not as verified evidence.
 */
export function buildTopicDiscoveryUserPrompt(manifestText: string, keyword?: string): string {
  const trimmedKeyword = keyword?.trim();

  if (trimmedKeyword) {
    return `=== 用户指定搜索方向（最高优先级）===\n${trimmedKeyword}\n\n这是用户想要搜索的方向本身，不是已经核实的事实——里面出现的任何具体数字/说法都只是待验证的线索，不能当作已确认结论直接写进候选题。\n\n=== 搜索结果 ===\n${manifestText}\n\n只能围绕上面这个方向找角度，不得因为搜索结果里出现了其他移民话题就偏移过去。`;
  }

  return `=== 今日自动选题模式（近期新闻检索结果）===\n${manifestText}\n\n没有人指定具体方向，这是自动扫描到的近期新闻。请先在内部判断哪些真的值得占用一个发布名额，淘汰只是新闻复述、没有真实内容角度的结果，再从留下的里面给出候选。`;
}

/**
 * Defensive re-validation of the model's own source_label claims (Round
 * 3A) — never trust the prompt alone to enforce this. A candidate whose
 * source_label doesn't match one of the search's real labeled results
 * (hallucinated label like "N99", or empty) is dropped rather than
 * failing the whole task — one bad label shouldn't discard every other
 * valid candidate in the same response.
 */
export function filterCandidatesByValidLabels(
  candidates: readonly TopicCandidate[],
  validLabels: readonly string[],
): TopicCandidate[] {
  const labelSet = new Set(validLabels);
  return candidates.filter((c) => labelSet.has(c.source_label));
}
