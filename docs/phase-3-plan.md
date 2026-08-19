# Phase 3 plan — Research Agent

This is the first milestone that calls a real model. Everything before
this point (topic library, scoring, workflow) was deterministic code.

## What "Research Agent" means here

Given a topic (`title`, `question`, `business`, `audience`), the agent
uses Anthropic's server-side `web_search` tool (Claude actually queries
the web — this isn't simulated) and returns a structured Research Pack:
a summary, key findings, sources, and any caveats. See
`src/lib/ai/research-agent.ts` (orchestration, server-only) and
`src/lib/ai/research-pack.ts` (pure parsing/grounding logic, unit-tested).

**It is general marketing research, not individualized legal advice, and
it must never be given or produce real client information** — see
`docs/security-boundaries.md` "AI usage" for exactly how that's enforced
(prompt instructions *and* a static UI warning that doesn't depend on the
model behaving).

## The anti-hallucination guarantee

The most important design decision this milestone: **every source shown
to a human is verified in code, not just requested via prompt.** After the
model responds, `src/lib/ai/research-agent.ts` extracts the actual search
results Anthropic's `web_search` tool returned in that response, and
`groundSources()` in `src/lib/ai/research-pack.ts` drops any source the
model *claims* in its JSON output that isn't backed by one of those real
results. If the model tries to cite something it didn't actually find,
that citation never reaches `research_sources` — see
`src/lib/ai/research-pack.test.ts` for the test coverage of this
specifically ("drops a fabricated source that was never actually
searched").

This is the concrete answer to "AI有没有瞎编" (did the AI make things up):
it structurally cannot present a fabricated URL as a real source, because
the code never trusts the model's own claim about what it found — only
what Anthropic's tool actually returned.

## Approval workflow

Two-person control, not a privilege hierarchy:

- **ADMIN can**: run research (`运行研究`), edit a research pack's
  narrative fields (`编辑研究成果`), and re-run research (same button,
  reused — a second click just creates another `research_runs` row).
- **EXPERT can**: approve research (`批准研究`) or request changes
  (`请求修改`). An ADMIN cannot approve their own research run — RLS
  enforces this at the database level (`research_approvals` insert policy
  requires `profiles.role = 'EXPERT'`), not just application code.

Approving research: (1) inserts a `research_approvals` row, (2) inserts a
`topic_activity_log` row (`research_approved`), (3) moves
`topics.status` from `RESEARCHING` to `RESEARCH_APPROVED`, and (4) writes
a `topic_status_events` row for that transition — all four in the same
action. "Do not allow content generation until research is approved" is
encoded as `canGenerateContent()` in `src/lib/permissions.ts`; content
generation itself doesn't exist yet, so nothing calls it yet, but the
rule is already in place for whenever it's built.

Requesting changes doesn't move the status (it's already `RESEARCHING`) —
it just records the decision and an optional note so the ADMIN knows to
re-run or edit before the Expert reviews again.

## AI usage log

Every call to `runResearchAgent()` writes one `ai_usage_log` row —
success or failure — with `workflow_type`, `model_alias`, `topic_id`,
token counts (null if the call failed before a response came back),
latency, and success/failure. See `docs/data-model.md`.

## What's still mocked / needs your verification

- **I cannot run this live.** It needs a real `ANTHROPIC_API_KEY` in
  `.env.local`, which this sandbox doesn't have. I built and unit-tested
  the parsing/grounding logic (`src/lib/ai/research-pack.test.ts`), and
  verified every page renders correctly with placeholder demo data — but
  "did it actually find real sources, and are they good" is something
  only a live run with your key can show, which is exactly why you asked
  to review this round yourself before I continue.
- The demo-mode Research Pack on `/topics/demo-t4` (visible with no
  Supabase/Anthropic configured at all) is placeholder text with fake
  `gov.uk`-style URLs, clearly labeled "占位演示数据" — it's there so the
  layout is reviewable without spending API credits, not as a claim about
  what a real pack looks like.
- `CONTENT_DRAFT` / `LEO_REVIEW` / `APPROVED` stages and any actual content
  generation remain out of scope, per your explicit instruction this
  round.

## Manual testing steps

1. Set `ANTHROPIC_API_KEY` (and optionally `RESEARCH_MODEL`) in
   `.env.local`, alongside your Supabase credentials.
2. Apply `supabase/migrations/0003_research_agent.sql` (and re-run
   `supabase/seed.sql` if you want the updated demo rows).
3. As a signed-in user with `ADMIN` role: go to 选题库 → 新建选题, create
   "老永居离境超过2年，身份还在吗？".
4. On the Topic Detail page, click **开始研究** (`IDEA → RESEARCHING` —
   this is unchanged from Phase 2, still no AI call).
5. Click **运行研究**. This is the real call — expect it to take some
   seconds to tens of seconds while it searches. When it finishes, you
   should see a Research Pack: summary, key findings, a sources list with
   real clickable links, and the always-present "专家审阅须知" warning
   banner.
6. To test approval, you need an `EXPERT` account (or temporarily change
   your own role to `EXPERT` from `/admin`, test, then change it back —
   `ADMIN` can update any profile's role, including its own). As that
   EXPERT, click **批准研究** — status should move to `RESEARCH_APPROVED`
   and the topic should now appear on `/research-completed`.
7. Check 动态记录 (activity log) on the Topic Detail page — you should see
   `research_run_started`, `research_run_completed`, and `research_approved`
   entries in order.

## Screenshot-friendly route to review

**`/topics/[id]`** (the Topic Detail page) after step 5 above — it's the
one page that shows the full Research Pack (summary, findings, sources
with links, warning banner) plus the approval controls, in one screen.
