# AI workflows

This document walks through the two AI-assisted workflows in the pipeline
end to end, from an ADMIN's perspective, and points to the architecture
docs for internals. For the multi-provider routing behind both workflows,
see `docs/model-router.md`; for how Research retrieves its evidence, see
`docs/search-router.md`. This file didn't exist before the Model Router
milestone; it's created now to hold this end-to-end view rather than
splitting it across `docs/architecture.md` and `docs/phase-3/4-plan.md`.

## Workflow 1 — Research (B 政策研究员)

1. A topic reaches a status where research can run (`IDEA` →
   `RESEARCHING` via "开始研究", or re-running from `RESEARCH_READY`).
2. ADMIN clicks "运行研究" on the Topic Detail page's 研究包 tab.
   `<GenerateAction>` shows the current effective model (from the Model
   Router — see `docs/model-router.md`) and, if it's paid/mixed-cost, a
   confirmation before anything runs.
3. `runResearch()` (`src/app/topics/research-actions.ts`) calls
   `runResearchTask()` (the Router). This first tries Tavily Search (the
   Development Mode default — if configured) for real sources, then hands
   them to the resolved AI model (Gemini by default) for analysis only;
   if no search provider is configured, it falls through to the original
   native path — Anthropic's `web_search` tool or Google's `googleSearch`
   grounding. See `docs/search-router.md` for why these were separated.
4. The result is grounded — every claimed source checked against real
   search results, regardless of which path ran (see `docs/architecture.md`
   "AI architecture") — logged to `ai_usage_log` (and, when the external
   Search path ran, `search_usage_log` too), and saved to `research_packs`
   / `research_sources`. The topic moves to `RESEARCH_READY`.
5. The research review page (`/topics/[id]/research/review`, also embedded
   in the Topic Detail page's 研究包 tab) shows the pack's six-dimension
   score and a deterministic "研究诊断" (which dimensions are actually
   dragging the score down, straight from `score_breakdown.reason` — never
   a second AI call just to restate it). What the operator can do next
   depends on the score, mirroring B's own Skill thresholds exactly (see
   "11. 总分对应结果" in `docs/digital-employee-skills.md`):
   - **90-100**: "通过，开始生成" is the primary action → `RESEARCH_APPROVED`,
     unlocking Content generation.
   - **80-89**: same "通过，开始生成" is available, with a caution that
     limiting language must survive into the content.
   - **70-79 / below 70**: "通过，开始生成" is not offered as a normal
     action at all — the primary actions are "优化研究" (see below) and
     "修改选题" (a plain link to editing the topic by hand).
   This boundary is enforced server-side, not just by hiding the button:
   `approveResearchOnly()` (`research-actions.ts`) and the `approve_research`
   Postgres function it calls (`supabase/migrations/0036_research_optimization_and_score_gate.sql`)
   both refuse to approve a pack scoring below 80 — a direct RPC call
   bypassing the UI hits the same wall.

## Research 优化 — B's second-stage mode

"优化研究" (`optimizeResearch`, `research-actions.ts`) is not a second
research system — it's B taking another, more targeted look at the SAME
topic, aimed specifically at whatever the six-dimension score exposed
last time, instead of repeating the same cold-start search:

1. `buildOptimizationSearchQueries()` (`research-queries.ts`) looks at
   which dimensions scored below 80% of their max and generates up to 6
   targeted queries — `official_sources` low → domain-restricted GOV.UK/
   Home Office queries; `policy_timeline` low → implementation-date/
   transitional-arrangement queries; `scope_exceptions` low → existing-
   holder/exception queries. A dimension that's already healthy spends no
   query budget. `fact_accuracy` / `data_reliability` / `external_safety`
   never get a query template — a search can't fix how the existing
   evidence is reasoned about or written up.
2. `runResearchOptimizationTask()` (`router.ts`) runs those queries through
   the same Search Router → lane-aware official-extraction pipeline as a
   normal research run, then dispatches to the Model Router with
   `RESEARCH_OPTIMIZATION_SYSTEM_PROMPT` (`research-optimization.ts`) —
   the previous pack's full summary/findings/warnings/confidence/per-
   dimension score+reason, plus the new evidence. The model works through
   each low-scoring dimension and must land on one of three honest
   outcomes, never simply a higher number:
   - the new evidence genuinely closes the gap → the score should
     honestly reflect that;
   - the new evidence doesn't close it, and on reflection the topic's own
     title/question claims more than any evidence supports → the model
     sets `topic_revision_suggestion` (a proposed title/question + a
     one-sentence reason), never rewriting the topic itself;
   - the government/Home Office genuinely hasn't published an answer yet
     → the model writes "NOT YET CONFIRMABLE" rather than speculating, and
     the score for that dimension stays low, honestly.
3. The result is saved as a **brand-new** `research_packs` row (a new
   `research_runs` row tagged `run_type: 'optimization'`) — the previous
   pack is never touched or deleted. `getLatestResearchPack()` already
   picks whichever pack is newest for a topic, the same mechanism a manual
   re-run has always relied on, so history comes for free. The review page
   shows a lightweight "已优化 N 次" hint, not a version browser.
4. If the new pack carries a `topic_revision_suggestion`, the review page
   shows the original title next to the suggested one with the model's
   reason, and offers "采用建议并重新研究" (`acceptSuggestedTopicRevision`
   updates the topic's title/question, logs the decision, then re-runs a
   normal research pass on the revised topic) or "保留原标题继续研究" (runs
   `optimizeResearch` again unchanged).
5. Optimization never touches `topics.status` — it's a same-stage
   refinement, not a pipeline transition. Approving still requires the
   separate, explicit "通过，开始生成" click once the score clears 80.

## Workflow 2 — Content generation (C 内容编辑)

1. Once a topic is `RESEARCH_APPROVED` or later, ADMIN can "生成内容" — a
   batch call that independently generates 视频号 / 小红书 / 公众号 drafts,
   each routed to its own configured model (three separate Router
   decisions, one click). A failure in one platform never blocks the
   others.
2. Each platform can be individually "重新生成" later, with its own
   model-override control (`更换本次模型`) — useful for spot-comparing how a
   different provider handles the same approved research, one manual run
   at a time. (The spec's optional "run two models automatically, keep
   both versions" A/B mode was not built this milestone — out of scope
   per "do not over-engineer.")
3. 公众号 has a second step: once an outline exists, "生成完整文章" expands
   it into the full article, following the outline's structure and claims.
4. Every generation is grounded against the approved Research Pack's
   sources (never a real URL shown to the model — numbered labels only,
   resolved back afterward) and scanned for a forbidden-phrase list;
   anything uncertain becomes an `expert_review_notes` entry rather than
   an assertion. See `docs/security-boundaries.md` "AI usage".
5. ADMIN can edit a draft's title/body directly (always creates a new
   version — nothing is silently overwritten).

## Where a human decision is always required

Neither workflow ever advances a topic's status, approves research, or
publishes content on its own. Every transition traces to an explicit
click from a signed-in `ADMIN` or `EXPERT` — see
`docs/security-boundaries.md` "Human approval gates". The Model Router
choosing a *different provider* for a task changes nothing about this —
it's an implementation detail of "which model produced this draft," not a
change to who approves what.

## Reliability note

`ai_usage_log` writes are no longer fire-and-forget — a write failure
(e.g. schema not yet migrated) is caught, logged server-side, and
surfaced as a restrained ADMIN-only notice on the Topic Detail page's 记录
tab, without ever discarding the Research/Content result that already
succeeded. See `docs/provider-smoke-test.md` "AI usage log reliability".

## Seeing what actually ran

`ai_usage_log` (see `docs/data-model.md`) records every attempt, success
or failure, including which provider/model actually ran it
(`provider`, `model_alias`, `task_type`, `digital_employee`,
`pricing_type_at_execution`). This is the source of truth for "which
model generated this content" / "which model researched this topic" —
never infer it from the current registry or current defaults, which can
change after the fact.
