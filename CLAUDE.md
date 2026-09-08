# CLAUDE.md

Guidance for any AI agent (or human) working in this repository.

## What this is

**LeoVisaAi 营销工作台** (LeoVisa AI Marketing Workbench) is an **internal
one-shot generation tool** for LeoVisa staff — not a system that tracks
ongoing work. Live user instruction (2026-09):

> 淘汰之后直接消失，要做成一个工具的感觉，就是不复用的工具。整个平台的思路
> 改了，现在就是完全做成一个工具。员工点开，直接生成选题，生成内容，拿到
> 内容之后直接就退出了，这个思路。

The intended use of the tool: a staff member opens a digital employee's
tool, works through one topic — generate it, research it, generate
platform content from it — and downloads the final result. That single
pass is the whole interaction. There is no dashboard of topics in flight,
no queue to come back to, no history to browse. A pass that's rejected at
any step, and a pass that reaches the final download, both end the exact
same way: the underlying data is gone (see rule 4 below). See the
"工具化" milestone context in the repo's plan history for the full
reasoning behind this shift — it deliberately replaces the earlier
"track a fixed content pipeline" model this file used to describe.

**This is the live model, not a migration target.** The single-click
generation flow (`GenerationRunner`, mounted on the home page) is the
default, real path: approve research → the pipeline runs
content → compliance → revision (if flagged) → final verification (if
revised) → 小红书图文规划 (if selected) → images → 打包下载, resumable and
concurrency-safe end to end (see `src/app/topics/pipeline-actions.ts`,
`supabase/migrations/0025_generation_runs.sql`,
`0028_generation_run_tasks.sql`). The old per-employee "queue" list pages
(选题库/可进入拍摄/本周已发布/内容资产库) still exist as routes but have no
entry point from the home page any more — leftover from the earlier
persistent-pipeline design, not a pattern to extend.

## What this is explicitly NOT

- **This is NOT a chatbot product.** There is no conversational interface
  anywhere in this app — not in Phase 1, not in any future phase — unless a
  human explicitly instructs it to be built.
- This is **not** a CRM.
- This is **not** a Lead Agent.
- This is **not** a Case Brain.
- This does **not** do social publishing (posting to platforms).
- This is **not** a client-facing chatbot.
- This does **not** do automatic immigration eligibility assessment.

None of the above get built "along the way" or "because it seemed useful."
They require an explicit, separate instruction from a human.

## Non-negotiable rules

1. **UI must remain minimal.** No decorative dashboards, no unnecessary
   charts/widgets, no dense enterprise-software chrome. Every screen should
   be readable in a few seconds. When in doubt, remove an element rather
   than add one.
2. **Client legal advice is out of scope.** This tool never generates,
   stores, or displays legal advice or eligibility determinations for
   clients.
3. **Sensitive client case data is out of scope.** See
   [docs/security-boundaries.md](docs/security-boundaries.md) for the exact
   list of data types that must never be stored here. Do not add a field,
   table, upload, or free-text box that could end up holding this data.
4. **Nothing persists past a session's outcome — and nothing about a
   session is user-facing history.** There is no pipeline status for
   staff to track and no audit trail for staff to browse. A session that
   is rejected at any step (研究淘汰, 合规淘汰, etc.), and a session that
   reaches the final download, both end the same way: every row belonging
   to that topic (research, content, images, compliance findings,
   activity/status-event rows) is deleted — cascading via the `topics`
   row's `on delete cascade` foreign keys — the moment the session ends.
   No soft-hide, no recycle bin, no way to recover it afterward. AI still
   never changes a topic's stage on its own — every step forward is still
   a deliberate human click — but the *record* of that click is not a
   retained product feature any more. See
   [docs/data-model.md](docs/data-model.md).
5. **API keys must never appear client-side.** The Supabase *anon* key is
   the only key allowed in the browser bundle (that's the standard, safe
   Supabase pattern — it is meaningless without Row Level Security, which is
   enabled on every table). The Supabase *service role* key must only ever
   be read inside server-only code (Server Actions), must never be prefixed
   with `NEXT_PUBLIC_`, and must never be imported from a file that a
   Client Component can pull in. See
   [docs/security-boundaries.md](docs/security-boundaries.md).
6. **Do not introduce future features without instruction.** If a prompt
   doesn't ask for it, don't build it "while you're in there." This
   includes Topic AI scoring, Research AI, chat, publishing automation, and
   anything on the "explicitly NOT" list above.

## Digital employee mental model (Boss Mode)

LeoVisaAi 营销工作台 uses a **"digital employee" mental model** for its
default (Boss Mode) presentation: the backend is workflow/agent-based
(Topic → Research Agent → Content Agent → Compliance Agent, gated by
human approval), but the user-facing Boss Mode presents that same backend
as **digital employees** (A 选题策划员 / B 政策研究员 / C-E three
platform-specific content editors + 图片设计员 / G 合规审核员 / H 终审修改员 /
I 内容整合员 / K 小红书图文规划员 — see `src/lib/boss-language.ts`
`DIGITAL_EMPLOYEES` for the exact current roster and letters) doing the
repetitive work, with **Leo** — the human — reviewing only the decisions
AI cannot responsibly make. Originally exactly four; every employee added
since went live by explicit live user instruction — H 终审修改员 takes what
G 合规审核员 flags and produces a revised draft (see
`src/app/topics/revision-actions.ts`); I 内容整合员 is purely a read-only
view assembling each platform's latest text + images together for Leo's
final look (no generation, no mutation — see
`src/app/team/integrator/page.tsx`); K 小红书图文规划员 splits off the
per-page 图文 planning + image generation that used to live inside D 小红书
标题文案员, so D now only writes the title/caption (see
`src/app/team/xiaohongshu-image-planner/page.tsx`). J 数据分析员 was later
retired entirely by explicit live user instruction (2026-09) — its route,
data-access code, `publish_performance` table, and uploaded screenshots
were all removed, not just hidden. Any further employee still requires an
explicit instruction. An ADMIN can give any employee a custom display name
(`employee_names` table); this never changes which employee owns which
task. See [docs/digital-employee-ux.md](docs/digital-employee-ux.md) for
the full mapping between employee UI and backend modules.

This is a **presentation-layer distinction only**:
- It never changes what a user is allowed to do — server-side role checks
  remain the sole source of authorization truth.
- It never invents data — every count, status, and queue item shown in
  Boss Mode must trace to a real row via an existing (or thin, obviously
  reusable) data-access function. Never fabricate a number.
- The interface must remain extremely minimal — no robot avatars, no
  cartoon illustrations, no gamified virtual office, no colourful AI
  aesthetic. Professional, restrained, typography-first.
- There is no separate "Admin Mode" to switch into any more — live user
  instruction removed the Boss/Admin view toggle (single-operator
  reality made switching between two presentations of the same data
  pointless). Every signed-in user sees the same home page; ADMIN simply
  also sees a "管理" nav link, gated on the real role directly, never a
  cookie-backed mode. The home page's collapsed "运营列表" section (quick
  counts + links to the pipeline-stage pages) was removed by live user
  instruction along with the explanatory subtitle/gate-note/loop-back
  text on the pipeline — home page is now just the numbered employee
  rail with no supporting prose (see src/app/page.tsx). Those
  pipeline-stage pages (选题库/可进入拍摄/本周已发布/内容资产库) still exist
  as routes but currently have no UI entry point from the home page.

Leo Visa uses formal versioned Digital Employee Skills. A Skill is a
production system instruction, not decorative profile copy. Each employee
has a narrow job boundary. Brand requirements are deterministic wherever
possible. See [docs/digital-employee-skills.md](docs/digital-employee-skills.md)
and [src/lib/ai/skills.ts](src/lib/ai/skills.ts).

## Digital employee ≠ AI model (Model Router)

No digital employee, and no task, is permanently tied to one AI provider
or model. The real chain is always **Digital Employee → Task Type →
Model Router → Provider → Model**, implemented in
[src/lib/ai/router.ts](src/lib/ai/router.ts). Do not write code that
hard-codes a provider for an employee or a task (e.g. `ResearchAgent =
Claude`) — always route through a task type and look up model metadata in
the Model Registry ([src/lib/ai/providers/registry.ts](src/lib/ai/providers/registry.ts)),
never scattered elsewhere. See
[docs/model-router.md](docs/model-router.md) for the full design.

Two rules that must hold for any future provider or model added to this
system:
- **No automatic FREE → PAID fallback.** If Development Mode can't find a
  free model that satisfies a task, the task fails with a clear message —
  it never silently reaches for a paid model.
- **A PAID or MIXED-cost model always shows a warning before running**,
  with provider/model/task named, and requires an explicit "继续运行"
  click. Boss Mode never shows model/provider details — this is
  exclusively an ADMIN concern.

## Search Provider ≠ AI Model (Search Router)

Retrieving evidence and reasoning about it are two independent steps for
Research: **Research Task → Search Router → Search Provider → Retrieved
Sources → Model Router → AI Model → Research Pack**, implemented in
[src/lib/search/](src/lib/search/) and
[src/lib/ai/router.ts](src/lib/ai/router.ts). Do not write code that
couples a search provider to a specific AI model (`GeminiResearchAgent`,
`BraveResearchAgent`) — the two route independently. See
[docs/search-router.md](docs/search-router.md) for the full design. The
same two rules from the Model Router apply here: no automatic FREE → PAID
fallback for search providers, and Boss Mode never shows search/provider
internals.

## Working agreement for this repo

Before any non-trivial change:
1. Inspect the repository.
2. Report current repository state.
3. Propose the file structure / schema changes.
4. State assumptions.
5. Then implement.

After implementation: run lint, typecheck, and tests, and fix all errors
before reporting the work as done.

Phase boundaries are real — see
[docs/phase-1-plan.md](docs/phase-1-plan.md). Phase 1 has **no AI features**.
Do not start Topic AI scoring or Research AI unless a later instruction
explicitly says so.

## Access model

Live user instruction (2026-09): "不要分用户登录了，彻底变成一个一次性工具"
— there are no per-person accounts any more. Access is gated by a single
shared password (`SITE_PASSWORD`) checked at `/login`
(`src/app/login/actions.ts`); anyone who knows it is transparently signed
in as one fixed, pre-existing Supabase Auth account (`OPERATOR_EMAIL`).
This was a deliberate choice over either extreme — fully public access
would let anyone who finds the URL trigger real paid AI calls; rewriting
the whole Supabase Auth/RLS/foreign-key layer (every content table's
`created_by`/`approved_by`/`decided_by`/... columns reference
`public.profiles`) for a single-operator tool wasn't worth the risk.

The `ADMIN`/`EXPERT` role field still exists in the data model
(`profiles.role`, `src/lib/permissions.ts`) purely because the fixed
operator account happens to be ADMIN — every permission check still
technically runs, it just always resolves the same way now. It is not a
choice a person makes any more; do not build UI that asks someone to pick
a role or manage other accounts (that surface — staff invite, role
management — was removed from `/admin` along with per-person login).

## Docs index

- [docs/architecture.md](docs/architecture.md) — system architecture and tech stack
- [docs/data-model.md](docs/data-model.md) — database schema and rationale
- [docs/phase-1-plan.md](docs/phase-1-plan.md) *(historical)* — what is and isn't in Phase 1
- [docs/phase-2-plan.md](docs/phase-2-plan.md) *(historical)* — Topic Library (选题库) milestone: scope, assumptions, what's still mocked
- [docs/phase-3-plan.md](docs/phase-3-plan.md) *(historical)* — Research Agent milestone: AI architecture, anti-hallucination design, approval workflow
- [docs/phase-3-5-plan.md](docs/phase-3-5-plan.md) *(historical)* — Research Agent hardening: RESEARCH_READY, confidence handling, full Phase 1 status model, expanded test coverage
- [docs/phase-4-plan.md](docs/phase-4-plan.md) *(historical)* — Content Agent: one research → three platform drafts, evidence boundary, source traceability, versioning
- [docs/digital-employee-ux.md](docs/digital-employee-ux.md) — the digital-employee presentation layer and its mapping to backend modules
- [docs/model-router.md](docs/model-router.md) — the multi-provider AI Model Router: task routing, the Model Registry, free-first Development Mode, paid-model warnings, provider/model override
- [docs/search-router.md](docs/search-router.md) — the Search Router: Search Provider ≠ AI Model, Tavily Search → analysis-model handoff, source-manifest grounding, free-first/no-fallback rule
- [docs/ai-workflows.md](docs/ai-workflows.md) — Research + Content generation walked through end to end, from an ADMIN's perspective
- [docs/provider-smoke-test.md](docs/provider-smoke-test.md) *(historical)* — a point-in-time record of an earlier manual smoke test
- [docs/security-boundaries.md](docs/security-boundaries.md) — the data boundary and key-handling rules

@AGENTS.md
