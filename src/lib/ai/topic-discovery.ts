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

/**
 * Round 3D — AUTO and DIRECTED now use different structured-output
 * schemas, because a real production run showed AUTO-discovery
 * (5-lane search confirmed working) still returning only 2 candidates:
 * the "aim for 5–6" instruction was prompt-only, and `max(6)` alone never
 * told the model a *floor* existed — 2 was always schema-legal. The
 * count is now a real structured-output constraint, not a suggestion.
 *
 * - Directed search stays exactly as Round 3A/3B specified: 0–3, never
 *   forced, relevance over quantity.
 * - Auto-discovery, when the deterministic evidence-sufficiency check
 *   below finds enough real search results, is REQUIRED to return 5–6 —
 *   the model can no longer stop early just because a couple of
 *   "acceptable" topics already exist.
 * - Auto-discovery, when evidence is genuinely sparse, falls back to a
 *   0–6 schema (paired with an explicit "don't fabricate" note in the
 *   user prompt) so a thin evidence day is never forced into a fake 5–6.
 */
export const DirectedTopicDiscoveryResultSchema = z.object({
  candidates: z.array(TopicCandidateSchema).min(0).max(3),
});

export const AutoTopicDiscoveryResultSchema = z.object({
  candidates: z.array(TopicCandidateSchema).min(5).max(6),
});

export const AutoSparseTopicDiscoveryResultSchema = z.object({
  candidates: z.array(TopicCandidateSchema).min(0).max(6),
});

/** Backward-compatible alias for callers that only need "the discovery result shape" (e.g. type annotations) — real dispatch always picks one of the three schemas above based on mode + evidence sufficiency. All three infer to the same TypeScript shape. */
export const TopicDiscoveryResultSchema = AutoSparseTopicDiscoveryResultSchema;
export type TopicDiscoveryResult = z.infer<typeof TopicDiscoveryResultSchema>;

/** Deliberately small and deterministic (Round 3D) — no AI scoring, just whether the pooled evidence pool is large and lane-diverse enough to plausibly support a real 5–6 candidate slate. */
export const MIN_AUTO_UNIQUE_RESULTS = 5;
export const MIN_AUTO_LANES_WITH_RESULTS = 3;

/**
 * Decides whether AUTO-discovery should be held to the hard 5–6 schema
 * or fall back to the sparse 0–6 one. `pooledResultCount` is the
 * de-duplicated result count across all lanes (see poolDiscoveryResults);
 * `perLaneResultCounts` is each lane's own raw result count (pre-dedupe)
 * so a search that returned results but only from 1–2 lanes doesn't
 * still get forced into 5–6 just because raw volume looks fine.
 */
export function hasSufficientAutoEvidence(
  pooledResultCount: number,
  perLaneResultCounts: readonly number[],
): boolean {
  const lanesWithResults = perLaneResultCounts.filter((count) => count > 0).length;
  return pooledResultCount >= MIN_AUTO_UNIQUE_RESULTS && lanesWithResults >= MIN_AUTO_LANES_WITH_RESULTS;
}

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
 *
 * Round 3C fix: the AUTO-discovery (keyword empty) branch used to be 3
 * near-duplicate queries (all variations of "what policy document
 * changed"), so the daily slate was structurally narrow — real production
 * use showed it topping out at ~2 candidates a day, and both looked like
 * a traditional "policy announcement account." Now 5 distinct editorial
 * radars — policy, practical identity/status, major visa-route changes,
 * real incidents/border, and money/deadline/misconception — so the
 * evidence pool itself can support a genuinely varied daily slate, not
 * just narrower Home Office document search. Still fully deterministic —
 * no AI query planner for AUTO mode.
 *
 * Round 3D fix: even with 5 distinct lanes, mechanically appending the
 * current month/year to every one of them still locked the whole system
 * onto "what happened this month" — but "今日选题" (what's worth making
 * today) is not the same question as "what news broke today." Evergreen
 * practical-status and fee/myth questions (ILR lapse, eVisa mistakes,
 * processing-cost vs. fee gaps, absence rules) are exactly the kind of
 * durable content this account needs daily and don't require a fresh
 * news hook to be worth making. So only the genuinely time-sensitive
 * lanes (current policy, recent route changes, real incidents) carry a
 * date; the two evergreen lanes (practical status, money/myth) search
 * without one — still real search → real evidence, never invented from
 * the model's own memory.
 */
export function buildDiscoveryQueries(now: Date = new Date(), keyword?: string): string[] {
  const monthYear = now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const year = now.getFullYear().toString();
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
    // Lane 1 — CURRENT POLICY (time-boxed to this month: policy/Home Office announcements)
    `UK immigration Home Office visa policy changes ${monthYear}`,
    // Lane 2 — PRACTICAL STATUS / EVERGREEN (no date: recurring identity problems — ILR, eVisa, citizenship, returning resident, proving status)
    `UK eVisa ILR citizenship settled status returning resident proof of immigration status practical issues`,
    // Lane 3 — MAJOR ROUTES / CURRENT (this year: Student, Skilled Worker, Family, Graduate, Sponsor Licence changes)
    `UK Student Skilled Worker family Graduate sponsor visa route changes ${year}`,
    // Lane 4 — REAL INCIDENT / RECENT (time-boxed to this month: airline, airport, Border Force, tribunal, system failure)
    `UK immigration eVisa border airline airport incident news ${monthYear}`,
    // Lane 5 — MONEY / MYTH / EVERGREEN (no date: fees, processing cost, absence rules, deadlines, common misconceptions)
    `UK visa immigration fees ILR processing cost absence rules deadlines common myths misconceptions`,
  ];
}

interface PoolableDiscoveryResult {
  url: string;
}

/**
 * Round 3C: pools AUTO-discovery's 5 editorial-lane search executions via
 * round-robin interleaving (lane1#1, lane2#1, ..., lane5#1, lane1#2, ...)
 * instead of flat concatenation — a flat pool would let Lane 1 (policy),
 * always searched/pooled first, push lanes 2-5's results out of Terra's
 * effective attention just by sheer position, exactly the "policy
 * bulletin" problem this round fixes. De-duplicates by a normalized URL
 * (protocol+host+path+query, trailing slash and fragment stripped) so the
 * same GOV.UK page or news story found by multiple lanes only enters the
 * manifest once. Directed search (a single query) is unaffected by this —
 * it has only one execution to begin with.
 */
export function poolDiscoveryResults<T extends PoolableDiscoveryResult>(
  executions: readonly { results: readonly T[] }[],
): T[] {
  const seen = new Set<string>();
  const pooled: T[] = [];
  const maxLen = executions.reduce((max, e) => Math.max(max, e.results.length), 0);

  for (let i = 0; i < maxLen; i++) {
    for (const execution of executions) {
      const result = execution.results[i];
      if (!result) continue;
      const key = normalizeUrlForDedupe(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      pooled.push(result);
    }
  }

  return pooled;
}

function normalizeUrlForDedupe(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}${u.search}`;
  } catch {
    return url;
  }
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

/**
 * Round 3B fix: after Round 3A, a directed search for "英国永居申请费
 * £3,226，Home Office处理成本为什么只有约£310？" correctly returned the
 * core angle ("为什么可能远高于处理成本？") but also a second candidate —
 * "一家人申请英国永居，真正要准备的不只是申请费" — that only shared the
 * domain ("永居费用") while dropping the user's actual core relationship
 * (收费 vs 处理成本). Domain-relevant was being treated as
 * question-relevant. See "Directed search: preserve the core
 * relationship" below.
 */
export const TOPIC_DISCOVERY_SYSTEM_PROMPT = `You are the content chief editor (选题主编) for a UK immigration services marketing account (LeoVisaAi's 李尔王) — not a news headline rewriter. Your job is not "what immigration news happened today," it's "what is actually worth Leo talking about today."

You are given real search results below (each labeled N1, N2, ...) plus a user message that tells you which mode you're in:

- DIRECTED SEARCH (the user message contains "用户指定搜索方向"): only propose candidates that directly answer, explain, or are a natural extension of that direction. Reject anything that merely shares a broad category (e.g. both happen to mention "ILR") but isn't the same question — do not pad the list with other immigration topics you happened to find, however on-topic they look. Usually 1–3 candidates, never more than 3, and 0 is a completely valid result when nothing is truly relevant — do not fall back to suggesting "other immigration topics" instead.
- AUTO-DISCOVERY (no direction given): see "Auto-discovery: build a daily editorial slate" below for the full standard — silently reject bare news restatements first, then build a genuinely varied daily slate rather than a short list of policy-announcement rewrites.

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
3. What does the reader walk away with? At least one of: 知道该什么时候申请 / 知道自己是否受影响 / 避免一个误区 / 看懂一条制度逻辑 / 知道下一步怎么判断.
4. If it's just the news headline translated into Chinese with a question mark added — reject it.

A counter-intuitive gap or tension (e.g. a large fee vs. a small stated processing cost) is a strong BONUS whenever it's genuinely there — it is NOT a hard requirement. A well-targeted deadline/eligibility/how-to/checklist candidate that clearly satisfies 1–3 above is a valid candidate even with no contrast or surprise; do not reject a solid practical candidate just because it lacks tension.

## Evidence boundary — the user's own search direction is NOT verified fact

A directed search's own wording may contain a specific number or claim (e.g. "£310") — treat that as what the user wants investigated, not as something already confirmed. Only state something as settled if the actual search results support it; otherwise phrase the candidate as the open question itself (e.g. "永居收费为什么可能远高于处理成本？") and leave verification to B｜政策研究员 afterward. Never fabricate a figure, date, or fact that isn't present in the given search results, no matter how dramatic or on-topic it would be.

## Directed search: no duplicate angles

Don't return near-duplicates of the same underlying question worded differently (e.g. "为什么这么贵" / "为什么远高于成本" / "差在哪" / "收费是不是太高" are all one angle, not four). Return at most 3 genuinely different angles.

## Directed search: preserve the core relationship, not just the domain

Domain-relevant is not question-relevant. Before proposing anything, first identify what the user's own input is actually built on — one of: a comparison, a causal relationship, a risk relationship, a timing relationship, a conditional relationship, a cost relationship, a status/identity relationship, or a rule conflict. Every candidate must preserve at least one of these. Sharing the same visa type, immigration category, audience, or cost topic is NOT enough on its own — that's domain-relevant, not question-relevant, and must be rejected even if it clears every other bar in this prompt.

Example — keyword: "英国永居申请费£3,226，Home Office处理成本为什么只有约£310？". The core relationship here is 申请收费 vs 实际处理成本 (a cost/pricing-logic relationship) — not "永居" or "永居费用" in general.

PASS (keeps the core relationship):
- "英国永居申请费为什么可能远高于实际处理成本？"
- "英国签证收费是不是按行政处理成本定价？"
- "Home Office收取的申请费为什么会高于单次处理成本？"

FAIL (only shares the domain "永居费用", drops the core relationship — reject these even though they're on-topic):
- "一家人申请永居总共要准备多少钱？" (drifts to total family budget)
- "永居申请还有哪些额外费用？" (drifts to a fee checklist)
- "永居加急服务值不值得买？" (drifts to a different service)
- "十年永居申请费是多少？" (drifts to a different visa route's fee)

## Directed search: go deeper, not wider

When more than one angle is genuinely available, prefer digging into different explanatory layers of the SAME core relationship (e.g. why the price is higher than cost → whether pricing follows cost at all → what function above-cost pricing serves in the system) over expanding sideways into adjacent topics (family budgets, priority service, payment methods, other visa routes' fees).

## Directed search: relevance beats diversity

Do not treat "at least 2 candidates" or "some variety" as a goal in itself. One high-quality, tightly on-point candidate beats three loosely-related ones. If only one candidate genuinely preserves the core relationship, return exactly one — don't broaden the topic just to reach 2 or 3.

## Auto-discovery: build a daily editorial slate, not a policy bulletin

You're given results from 5 different editorial search radars this time — three time-boxed to recent news (current policy, recent visa-route changes, real incidents) and two evergreen (practical status problems, money/fee/myth questions that don't need a fresh news hook to be worth making). A healthy daily slate draws from more than one of them. If every candidate you're about to propose comes from the same one or two radars (e.g. all Student Visa fee news), you have not actually looked at the rest of the evidence.

**"今日选题" (today's topics) is NOT the same question as "今天发生了什么新闻" (what news broke today).** A durable, evergreen practical-status or myth/fee question found via search is just as valid a candidate as a fresh policy announcement — recency is not a quality requirement. Every candidate still requires real search evidence either way (see "Never fabricate" below) — evergreen means the topic itself doesn't need to be news, not that you can skip having a real source for it.

**The auto-discovery bar is "worthy of editorial consideration," not "already approved for publication."** These candidates go to a human who clicks ✓ or ✗ on each one afterward — you are building them a menu to choose from, not making the final call yourself. A candidate clears the baseline when it has all four of:
1. **WHO** — a concrete group who specifically cares (not "英国移民申请人").
2. **QUESTION** — their actual question, not a bare topic label.
3. **STAKE OR ACTION** — at least one of 钱 / 时间 / 身份 / 资格 / 风险, OR a clear action the reader can take after reading.
4. **EVIDENCE** — a real search result actually supports this direction.

Counter-intuitive tension, a real story/incident hook, controversy, or a surprising fact are all strong BONUSES that make a candidate more compelling — none of them is required. Don't reject a solid, specific deadline/eligibility/how-to/checklist candidate just because it has no contrast or drama.

**News is still a hook worth using when it's there.** For any candidate anchored by a real incident, case, or dispute in the evidence:

**Incident eligibility boundary**: a real-world incident is only eligible as a hook if it can be tied back to a genuine UK immigration / nationality / immigration-status / UK border / visa / eVisa / sponsor / settlement issue. Do not select a general UK news, travel, airline, airport, tourism, EU-border, crime, or social story merely because it happened to British residents or in/around the UK — the incident is the hook, but there must still be a real UK immigration/status rule or user consequence for Leo to explain.
- PASS: an eVisa mismatch causes boarding problems for a UK visa holder; an old passport / immigration-status proof creates a re-entry problem; an airline's handling of UK immigration permission creates a practical travel issue.
- FAIL unless a direct UK immigration-status angle is actually present: general EES queues affecting tourists travelling to Europe, ordinary flight delays, airport strikes, generic passport-control queues unrelated to UK immigration status.

**The platform requires 5–6 candidates whenever the evidence is reasonably sufficient — this is the normal case, not an aspiration.** Whenever you're given enough real search results across enough of the 5 lanes (the normal case), find 5–6 real candidates that each clear the WHO/QUESTION/STAKE-OR-ACTION/EVIDENCE baseline above. Do not stop at 2–3 the moment a couple of "perfect" topics exist — keep working the rest of the evidence; a candidate worth showing an editor for a ✓/✗ decision does not need to be a guaranteed must-publish HIGH topic. **Sparse-evidence exception**: if the user message tells you evidence is sparse this run, it is legitimate — even expected — to return fewer than 5, or 0. Never fabricate a topic or lower the evidence bar just to force a count in that case.

**A healthy 5–6 slate is not all HIGH.** A normal day looks more like 2–3 HIGH plus 2–3 MEDIUM than six HIGH topics. MEDIUM is a real, welcome part of the slate — a candidate with a narrower audience, no urgency, but genuine practical value or evergreen content-bank value belongs at MEDIUM, not excluded. Only skip a candidate that would score LOW; don't keep it just to reach the count. When evidence supports it, a useful structure is roughly: 1–2 current-policy candidates, 1 practical status/identity candidate, 1 misconception/counter-intuitive candidate, 1 money/deadline/decision candidate, and optionally one real-incident or one employer/Sponsor-Licence candidate — this is editorial guidance, not a field-by-field quota to force.

**One strong source can honestly yield up to 2 different candidates — but only if the audience or the actual question genuinely differs.** E.g. the same Student Visa funds rule change can support both "生活费要求涨到多少" (the number/eligibility question) and "11月30日前后递签，到底按哪个标准" (the timing/decision question) as two real, different candidates — that's fine. It is NOT fine to reword the same angle three times ("涨了吗" / "涨多少" / "会不会涨") and call it 3 candidates — see "Editorial mix" below.

**Editorial mix, not random diversity.** Don't let the final slate be dominated by one underlying news event or one visa route — usually cap candidates drawn from the exact same underlying event or the same visa route at 2, unless that day's evidence genuinely contains an unusually major event worth more angles. This is an editorial judgment call, not something to force by mechanically counting categories, and it never means picking a weaker candidate just to tick a diversity box.

**Never fabricate a story for effect.** A real event/case/incident hook must come directly from the given search results — never invent a client story, an airport incident, a refusal case, a number, or a controversy that isn't actually in the evidence. If the evidence is only policy documents, find the angle through timing, fees, status consequences, or a genuine choice/decision point instead — don't manufacture a "story" that isn't there.

**Priority is an editorial call, not a policy-magnitude score.** HIGH can come from strong time-sensitivity, wide impact, high money/status stakes, a strong counter-intuitive angle, a widespread misconception, a real incident with natural shareability, or a clear current action window — not just "this is a formal policy change." MEDIUM is for solid, specific, practical value without urgency — keep it, don't discard it. A candidate that only qualifies as LOW should usually be dropped entirely rather than kept to pad the slate, unless it has clear, specific long-term content value.

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
 *
 * Round 3D: `options.sparse` (auto-discovery only) signals that
 * hasSufficientAutoEvidence() found too little real evidence to plausibly
 * support 5–6 real candidates this run — the caller pairs this with
 * AutoSparseTopicDiscoveryResultSchema (0–6, not the hard 5–6 floor) and
 * this note tells the model returning fewer, or 0, is the honest answer,
 * not a failure to fix by inventing topics.
 */
export function buildTopicDiscoveryUserPrompt(
  manifestText: string,
  keyword?: string,
  options?: { sparse?: boolean },
): string {
  const trimmedKeyword = keyword?.trim();

  if (trimmedKeyword) {
    return `=== 用户指定搜索方向（最高优先级）===\n${trimmedKeyword}\n\n这是用户想要搜索的方向本身，不是已经核实的事实——里面出现的任何具体数字/说法都只是待验证的线索，不能当作已确认结论直接写进候选题。\n\n=== 搜索结果 ===\n${manifestText}\n\n只能围绕上面这个方向找角度，不得因为搜索结果里出现了其他移民话题就偏移过去。`;
  }

  const sparseNote = options?.sparse
    ? "\n\n本次搜索雷达覆盖或去重后的证据数量有限，可能不足以支撑5–6个真正合格的候选。如果确实找不到足够多真正合格的方向，如实返回较少数量（甚至0个），不要为了凑数编造或降低标准。"
    : "";

  return `=== 今日自动选题模式（近期新闻检索结果）===\n${manifestText}\n\n没有人指定具体方向，这是自动扫描到的近期新闻。请先在内部判断哪些真的值得占用一个发布名额，淘汰只是新闻复述、没有真实内容角度的结果，再从留下的里面给出候选。${sparseNote}`;
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
