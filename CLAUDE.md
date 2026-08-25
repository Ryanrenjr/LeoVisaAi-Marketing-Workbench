# CLAUDE.md

Guidance for any AI agent (or human) working in this repository.

## What this is

**LeoVisaAi 营销工作台** (LeoVisa AI Marketing Workbench) is an **internal
operations tool** for LeoVisa staff to track marketing content moving
through a fixed content pipeline:

`草稿 (draft)` → `研究已完成` → `可进入拍摄` → `本周已发布`

It exists so staff can see, at a glance, what content ideas have been
researched, what's ready to film, and what shipped this week.

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
4. **Human approval gates are mandatory.** No pipeline status transition
   happens automatically or via AI. Every transition is a deliberate click
   by a signed-in `ADMIN` or `EXPERT` user, and every transition is recorded
   (who approved it, when, from what status, to what status) in
   `topic_status_events`. See [docs/data-model.md](docs/data-model.md).
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
I 内容整合员 / J 数据分析员 / K 小红书图文规划员 — see `src/lib/boss-language.ts`
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
`src/app/team/xiaohongshu-image-planner/page.tsx`). Any further employee
still requires an explicit instruction. An ADMIN can give any employee a
custom display name
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

## Roles

- `ADMIN` — full access, manages staff accounts and roles.
- `EXPERT` — manages the content pipeline (create topics, advance status).

Both are internal-staff-only roles. There is no client-facing account type
in this application.

## Docs index

- [docs/architecture.md](docs/architecture.md) — system architecture and tech stack
- [docs/data-model.md](docs/data-model.md) — database schema and rationale
- [docs/phase-1-plan.md](docs/phase-1-plan.md) — what is and isn't in Phase 1
- [docs/phase-2-plan.md](docs/phase-2-plan.md) — Topic Library (选题库) milestone: scope, assumptions, what's still mocked
- [docs/phase-3-plan.md](docs/phase-3-plan.md) — Research Agent milestone: AI architecture, anti-hallucination design, approval workflow
- [docs/phase-3-5-plan.md](docs/phase-3-5-plan.md) — Research Agent hardening: RESEARCH_READY, confidence handling, full Phase 1 status model, expanded test coverage
- [docs/phase-4-plan.md](docs/phase-4-plan.md) — Content Agent: one research → three platform drafts, evidence boundary, source traceability, versioning
- [docs/digital-employee-ux.md](docs/digital-employee-ux.md) — the digital-employee presentation layer and its mapping to backend modules
- [docs/model-router.md](docs/model-router.md) — the multi-provider AI Model Router: task routing, the Model Registry, free-first Development Mode, paid-model warnings, provider/model override
- [docs/search-router.md](docs/search-router.md) — the Search Router: Search Provider ≠ AI Model, Tavily Search → analysis-model handoff, source-manifest grounding, free-first/no-fallback rule
- [docs/ai-workflows.md](docs/ai-workflows.md) — Research + Content generation walked through end to end, from an ADMIN's perspective
- [docs/provider-smoke-test.md](docs/provider-smoke-test.md) — real end-to-end verification results: migration status, provider connectivity, live smoke-test findings
- [docs/security-boundaries.md](docs/security-boundaries.md) — the data boundary and key-handling rules

@AGENTS.md
