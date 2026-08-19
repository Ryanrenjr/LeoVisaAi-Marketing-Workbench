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
(Topic → Research Agent → Content Agent, gated by human approval), but
the user-facing Boss Mode presents that same backend as **four digital
employees** (A 选题策划员 / B 政策研究员 / C 内容编辑 / D 合规审核员) doing the
repetitive work, with **Leo** — the human — reviewing only the decisions
AI cannot responsibly make. See
[docs/digital-employee-ux.md](docs/digital-employee-ux.md) for the full
mapping between employee UI and backend modules.

This is a **presentation-layer distinction only**:
- It never changes what a user is allowed to do — server-side role checks
  remain the sole source of authorization truth.
- It never invents data — every count, status, and queue item shown in
  Boss Mode must trace to a real row via an existing (or thin, obviously
  reusable) data-access function. Never fabricate a number.
- The interface must remain extremely minimal — no robot avatars, no
  cartoon illustrations, no gamified virtual office, no colourful AI
  aesthetic. Professional, restrained, typography-first.
- Admin Mode (for `ADMIN`) keeps full operational access to the
  underlying system; Boss Mode is an abstraction over the same data, not
  a separate product.

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
- [docs/digital-employee-ux.md](docs/digital-employee-ux.md) — Boss Mode / Admin Mode: the digital-employee presentation layer and its mapping to backend modules
- [docs/security-boundaries.md](docs/security-boundaries.md) — the data boundary and key-handling rules

@AGENTS.md
