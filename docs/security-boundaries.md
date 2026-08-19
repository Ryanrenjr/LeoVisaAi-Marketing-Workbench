# Security boundaries

## Data this application must NEVER store

Every phase (unless a human explicitly changes this document) must not
store:

- Passport data
- Date of birth
- Home address
- Criminal history
- Refusal letters
- Bank information
- Real client case documents
- Any other sensitive client immigration-matter data

This isn't enforced by a filter or validator — it's enforced by never
adding a field, table, upload capability, or free-text box that could hold
this data. `topics.question`/`business`/`audience` are short plain-text
*marketing* fields describing a content idea (e.g. "老永居离境超过2年，身份还在吗？"),
not a case file. There is no document upload feature anywhere in this app.

This also governs what the Research Agent is allowed to be told and asked
to produce — see "AI usage" below.

If a future instruction asks for something that would require storing any
of the above, treat that as a conflict with this document and flag it
before implementing.

## Things this application must NOT become

- A CRM
- A Lead Agent
- A Case Brain
- A social publishing tool
- A client-facing chatbot
- An automatic immigration eligibility assessment tool

## API key handling

- **Supabase anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`): safe to ship in
  the browser bundle. It is meaningless without Row Level Security, which
  is enabled on every table. This is the standard, intended Supabase usage
  pattern — it is not a leak.
- **Supabase service role key** (`SUPABASE_SERVICE_ROLE_KEY`): bypasses
  RLS entirely. Rules:
  - Never prefix it with `NEXT_PUBLIC_`.
  - Only `src/lib/supabase/admin.ts` may read it from `process.env`.
  - Only Server Actions/Route Handlers may import that module — never a
    Client Component (`"use client"` file).
  - Every code path that uses it must first check the caller's session and
    role in application code; RLS bypass is not a substitute for that
    check, it's why the check is mandatory.
- **`ANTHROPIC_API_KEY`**: same rules as the service role key. Never
  prefix with `NEXT_PUBLIC_`. Only `src/lib/ai/research-agent.ts` and
  `src/lib/ai/content-agent.ts` read it (implicitly, via the SDK's default
  env lookup). Only Server Actions (`src/app/topics/research-actions.ts`,
  `src/app/topics/content-actions.ts`) trigger a call, and only after
  checking the caller's role (`canRunResearch`/`canManageContentAssets`)
  *and* the topic's status gate.
- No API key (of any kind) is ever passed as a prop into a Client
  Component, embedded in a data attribute, or logged.

## AI usage

`src/lib/ai/research-agent.ts` and `src/lib/ai/content-agent.ts` are the
only places in this app that call a model. Rules that apply to both, and
to any future model integration:

- **General marketing content only — never individualized legal advice.**
  Both agents' system prompts explicitly state this. The Topic Detail page
  also always renders a static "专家审阅须知" (Expert review notice) banner
  next to any research pack, independent of whatever the model actually
  said — this is a deterministic UI control, not something that depends on
  the model remembering its instructions. See
  `src/components/research-pack-view.tsx`.
- **The approved Research Pack is the Content Agent's evidence boundary.**
  It must not state a new immigration rule, policy detail, deadline, or
  number that isn't traceable to that Research Pack — anything it can't
  support goes into `expert_review_notes` (`research_gap` or
  `expert_review_required`) instead of being asserted. This is a prompted
  rule (see `CONTENT_AGENT_SHARED_RULES` in `src/lib/ai/content-schemas.ts`),
  **not mechanically verifiable** — code cannot check whether a sentence
  is "supported by the research"; a human reviewing the
  `expert_review_notes` and the content itself is still required. What
  code *does* enforce: fear-based/hype language (a fixed phrase list) is
  scanned for and flagged, and every source citation is grounded (below).
- **No real client information ever enters a prompt.** The only topic
  fields sent to either agent are `title`, `question`, `business`,
  `audience`, `content_pillar` — general-marketing fields. There is no
  code path that reads from a client/case data source (none exists in
  this app) and includes it in a model call.
- **Sources must be real, not fabricated — for both agents.** The
  Research Agent cross-checks every source it claims against the actual
  `web_search` tool results in that response (`groundSources`). The
  Content Agent never lets the model see a real URL at all — sources are
  presented as numbered labels ("S1", "S2"), the model may only cite by
  label, and any label that doesn't match one actually given is dropped
  before resolving to a real `research_sources.id`
  (`groundContentSources`). Both are code-level guarantees with test
  coverage, not prompting requests.
- **Every model call is logged**, success or failure, to `ai_usage_log`
  (`workflow_type`, `model_alias`, `topic_id`, `platform` for content
  calls, token counts, latency, success/failure, timestamp) — see
  `docs/data-model.md`.
- **Content generation is gated behind research approval, enforced
  server-side.** `canGenerateContent()` in `src/lib/permissions.ts`
  requires the topic's status to be `RESEARCH_APPROVED` or later; every
  content Server Action checks it directly (`loadGenerationContext` in
  `src/app/topics/content-actions.ts`) before calling Anthropic or writing
  any row — not only by hiding the button. See `docs/phase-4-plan.md`.

## Human approval gates

No pipeline status transition happens automatically on a timer, or as a
side effect of anything AI-driven *unprompted by a person*. Every
transition — `IDEA` → `RESEARCHING` → `RESEARCH_READY` →
`RESEARCH_APPROVED` → `CONTENT_DRAFT` → `READY_TO_SHOOT` → `PUBLISHED`,
`RESEARCH_READY` → `RESEARCHING` (changes requested), or `* → ARCHIVED` —
traces to an explicit button click from a signed-in `ADMIN` or `EXPERT`
user, through a Server Action that re-checks the caller's session and role.

`RESEARCH_READY → RESEARCH_APPROVED` and `RESEARCH_READY → RESEARCHING`
additionally write a `topic_status_events` row, `approved_by = auth.uid()`,
enforced by RLS — nobody can record an approval on someone else's behalf.
`RESEARCH_APPROVED → CONTENT_DRAFT` is different in kind: it isn't a
second human *approving* something, it's the direct, deterministic result
of an ADMIN's own explicit "生成内容" click succeeding — there's no
separate approval step for "may content generation begin," only the
`RESEARCH_APPROVED` gate itself (which *did* require Expert approval to
reach). Running either the Research Agent or the Content Agent never
changes `topics.status` on its own initiative — a human's click is what
triggers the call, and success/failure of that specific call is what
(sometimes) moves the status, never a background process.

## Authentication & sessions

- Supabase Auth (email/password) issues sessions stored in httpOnly
  cookies via `@supabase/ssr`; no tokens are stored in `localStorage`.
- `src/proxy.ts` refreshes the session on every request and redirects
  unauthenticated requests away from protected routes.
- There is no client-facing account type — every authenticated user is
  internal staff (`ADMIN` or `EXPERT`).

## Reviewing changes against this document

Any change that adds a new database column, a new upload capability, a new
integration, or a new externally-facing surface should be checked against
this document before merging. If in doubt, ask before storing it.
