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
- [docs/security-boundaries.md](docs/security-boundaries.md) — the data boundary and key-handling rules

@AGENTS.md
