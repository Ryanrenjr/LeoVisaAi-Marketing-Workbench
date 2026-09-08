# Architecture

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript, React Server
  Components + Server Actions).
- **Styling**: Tailwind CSS v4. No component library — a handful of small,
  hand-written primitives in `src/components/ui/`, kept deliberately
  minimal.
- **Backend**: Supabase (Postgres + Auth). No separate backend service —
  authorization is enforced at the database layer via Row Level Security
  (RLS), and privileged operations run through Next.js Server Actions
  using the Supabase service-role key, which never leaves the server.
  Several safety-critical sequences (atomic subtask claims, the login
  rate limiter, research approval) are implemented as Postgres functions
  called via `.rpc()` rather than sequential JS calls, specifically so the
  whole sequence is one transaction — see "Request flow" below.
- **Access model**: no per-person accounts. A single shared
  `SITE_PASSWORD` (rate-limited per-IP, atomically, via the
  `record_login_attempt()` Postgres function) transparently signs anyone
  who knows it in as one fixed, pre-existing `OPERATOR_EMAIL` Supabase
  Auth account (`src/app/login/actions.ts`). The `ADMIN`/`EXPERT` role
  field still exists in the data model purely because that fixed account
  happens to be `ADMIN` — see CLAUDE.md "Access model".
- **AI**: multi-provider via the Model Router (`src/lib/ai/router.ts`) —
  Anthropic (`@anthropic-ai/sdk`), Google Gemini (`@google/genai`), Groq
  (`groq-sdk`), OpenRouter (raw HTTP), and OpenAI (raw HTTP). No business
  logic calls a provider SDK directly; everything routes through
  task-type-based selection. Structured output validated with Zod
  regardless of provider. Research additionally routes through the Search
  Router (`src/lib/search/router.ts`) first — Tavily/Brave retrieve real
  sources, then the resolved AI model (any provider, including one with
  no native web-search capability of its own, like OpenAI) analyses them.
  See "AI architecture" below, `docs/model-router.md`, and
  `docs/search-router.md`.
- **The one-click generation pipeline** (`GenerationRunner`, mounted on
  the home page): content → compliance → revision (if flagged) → final
  verification (if revised) → 小红书图文规划 (if selected) → images →
  manual 打包下载, resumable across refreshes/crashes and safe against two
  concurrent requests double-billing the same AI call. Backed by
  `generation_runs` (one row per topic, tracks which steps completed) and
  `generation_run_tasks` (one row per billable subtask, an atomic Postgres
  `claim_generation_run_task()` function is the actual mutual-exclusion
  mechanism) — see `src/app/topics/pipeline-actions.ts`,
  `src/components/generation-runner.tsx`,
  `supabase/migrations/0025_generation_runs.sql` and
  `0028_generation_run_tasks.sql`.
- **One-shot data lifecycle**: there is no retained pipeline/audit history
  as a product feature. A topic is deleted (`discardTopic()`) the moment
  its session ends, whether it was rejected at any step or reached a
  final download — every child table cascades away with it. See CLAUDE.md
  rule 4 and `docs/data-model.md`.
- **Testing**: Vitest + React Testing Library. Every test mocks external
  providers/Supabase — no test suite makes a real network call, which is
  what lets `.github/workflows/ci.yml` run the full suite with no API
  keys configured.

## Why this stack

The app is small, internal, and low-traffic. A single Next.js deployment
talking directly to Supabase (via the anon key + RLS from the browser/server
components, and the service-role key only inside Server Actions) avoids
standing up and operating a separate API service for no benefit.

## Directory layout

```
src/
  app/                    route segments (App Router)
    layout.tsx            root layout: minimal chrome, nav
    page.tsx              home page — the numbered 9-step employee rail
                           (src/components/pipeline-flow.tsx) plus
                           GenerationRunner when ?generating=<topicId> is
                           present
    login/                public route — single shared-password gate
    topics/                the Topic Library (选题库) and the pipeline
                            Server Actions that drive a topic through it
      page.tsx             list of active (IDEA/RESEARCHING) topics
      new/page.tsx          create form
      actions.ts            create/update/rescore/start-research/archive/
                             discardTopic (the one-shot hard-delete)
      research-actions.ts   run research, edit pack, approveResearchOnly
                             (delegates to the approve_research() RPC —
                             one atomic transaction, see
                             supabase/migrations/0029_approve_research_rpc.sql)
      content-actions.ts     generate/regenerate/edit content drafts, full article
      pipeline-actions.ts     the one-click generation pipeline's granular
                               steps (content/compliance/revision/final
                               verification/planning/images) plus
                               generation_runs bookkeeping — what
                               GenerationRunner actually calls
      compliance-actions.ts / revision-actions.ts   Employee G/H, each
                               subtask wrapped in an atomic claim (see
                               src/lib/generation-run-tasks.ts) when
                               called from the orchestrated pipeline
      [id]/page.tsx          Topic Detail: tabs — 研究包/视频号/小红书/公众号/合规/记录
      [id]/edit/page.tsx     edit topic fields
      [id]/research/edit/    edit a research pack's narrative fields (ADMIN)
      [id]/content/[assetId]/edit/  edit a content draft (ADMIN, creates a new version)
    research-completed/   pipeline-stage list view (status RESEARCH_APPROVED) —
                            no entry point from the home page any more, see
                            CLAUDE.md
    ready-to-shoot/        pipeline-stage list view, same caveat
    published/             pipeline-stage list view, same caveat, scoped to
                            the current week
    admin/                 ADMIN-only: AI model configuration only — no
                            staff/role management UI (there's only ever
                            one account, see "Access model" above)
      ai-models/page.tsx     AI 模型配置 — per-task-type model default selection,
                              provider connection status, dev-mode indicator
  components/              presentational + small interactive components
    generation-runner.tsx    the one-click generation pipeline's client-side
                              driver — two-phase mount (fetch-or-create the
                              persisted generation_runs row, then run
                              whichever steps aren't done yet), auto-retry
                              with backoff, "重试当前步骤"/"结束并清空" on a
                              real failure
    pipeline-flow.tsx         the home page's numbered employee rail —
                               StageRow/LaneGroup/LaneCard, real pipeline
                               order, "conditional" steps chip-labeled
    ui/                     generic primitives (button, etc.)
    content/                 platform-specific content views, tabs, shared bits
                              (expert-review-notes, content-sources, field)
  lib/
    generation-run-tasks.ts  the atomic per-subtask claim (see the
                              generation_run_tasks paragraph above) —
                              claimGenerationRunTask/
                              completeGenerationRunTask/failGenerationRunTask
    supabase/
      client.ts             browser Supabase client (anon key)
      server.ts              server Supabase client (anon key, cookie-bound session)
      admin.ts               server-only Supabase client (service role key)
    ai/
      router.ts                the Model Router — the ONLY entry point research-actions.ts
                                /content-actions.ts call; resolves a task to a
                                provider+model and dispatches, server-only
      model-selection.ts        pure: dev-mode free-first / override / configured-default
                                 precedence — no Supabase, fully unit-tested
      model-config.ts            data-access: ADMIN's persisted per-task model
                                  defaults (model_routing_config), server-only
      task-model-options.ts       server-only: precomputes what the Topic Detail
                                   page's <GenerateAction> needs to render
      providers/
        types.ts                  provider-agnostic types (AIProviderId, TaskType,
                                   ModelRegistryEntry, AIExecutionResult<T>) — pure
        registry.ts                 the Model Registry — single source of truth for
                                     model metadata (pricing type, capabilities, etc) — pure
        anthropic-provider.ts        adapter: delegates to research-agent.ts /
                                      content-agent.ts unchanged, normalizes the result
        google-provider.ts            real Gemini implementation (web-search
                                       grounding for research, JSON mode for content)
        groq-provider.ts               real Groq implementation (JSON mode; no
                                        web-search capability registered)
        openrouter-provider.ts          real OpenRouter implementation via raw HTTP
      research-agent.ts      Anthropic-specific orchestration, server-only —
                              UNCHANGED by the Model Router milestone
      research-pack.ts        pure parsing/grounding logic — no network,
                               no server-only import, fully unit-tested
      content-agent.ts         Anthropic-specific orchestration (structured
                                outputs via Zod), server-only — UNCHANGED
      content-schemas.ts        pure: Zod schemas, source-manifest/grounding,
                                 prompts, plus the provider-agnostic
                                 applyGroundingAndSafety() every non-Anthropic
                                 provider's content path also uses — no network,
                                 fully unit-tested
      research-queries.ts       pure: derives up to 3 search queries from
                                 topic context, ranks results toward
                                 primary (gov.uk etc) sources — no network
      research-external.ts       pure: the external-search (Search Router
                                  → model) Research prompt, Zod schema,
                                  label manifest, and grounding — mirrors
                                  content-schemas.ts's pattern, no network
    search/
      types.ts                  SearchProviderId, SearchResult,
                                 SearchExecutionResult — pure
      registry.ts                 the Search Provider Registry (Tavily —
                                   FREE, the dev default; Brave — PAID,
                                   available but not preferred) — pure
      search-selection.ts          pure selection logic, mirrors
                                    ai/model-selection.ts exactly
      router.ts                    the Search Router — runs queries,
                                    classifies failures, server-only
      search-health.ts             ADMIN-only real connectivity check
      providers/
        tavily-provider.ts           real Tavily Search API implementation
        brave-provider.ts            real Brave Search API implementation
    data-integrity.ts        pure: flags topics whose pipeline status
                              implies AI-generated data that doesn't
                              actually exist (e.g. seeded directly at an
                              advanced status) — admin-visible check, not
                              a database constraint
    auth.ts                  session/role helpers used by pages and actions
    types.ts                  shared TypeScript types for the data model
    status.ts                 labels for status/pillar/priority/activity/platform
    topic-workflow.ts          linear pipeline transition rules (full 10-stage order)
    research-workflow.ts        research-stage status gates (run/approve/request changes)
    content-mapping.ts           pure title/content derivation + edit-merge for
                                  content assets (kept out of content-actions.ts,
                                  since "use server" files may only export async fns)
    content-versions.ts          pure lineage grouping + next-version-number logic
    permissions.ts              role-gated action checks (who can do what)
    scoring.ts                   deterministic topic-score formula
    topic-validation.ts           topic input validation
    topics.ts                     data-access layer (with demo fallback)
    demo-data.ts                  static fallback content, used only when
                                   Supabase is not configured or unreachable
  proxy.ts                 session refresh + route protection
supabase/
  migrations/               schema + RLS policies, one file per milestone
  seed.sql                  demo data (topics, activity, a demo research pack)
docs/                       this documentation set
```

## Request flow

1. `src/proxy.ts` runs on every request, refreshes the Supabase session
   from cookies, and redirects unauthenticated requests to `/login` (except
   `/login` itself and static assets). On Vercel with Supabase
   unconfigured it fails closed (503), and it checks the signed-in
   session's email actually matches `OPERATOR_EMAIL` before allowing
   access through.
2. Server Components (page.tsx files) read data directly from Supabase
   using the server client, which carries the caller's session — so every
   read is subject to that user's RLS policies (tightened to `ADMIN`-only
   on nearly every table, see `docs/security-boundaries.md`), not a
   service role.
3. Mutations (create/edit a topic, advance status, run research, approve
   research, generate/review/revise content) go through Server Actions in
   colocated `actions.ts` files. Actions re-check the caller's
   session/role before doing anything privileged; RLS is the backstop,
   not the only check. Several safety-critical sequences call a Postgres
   function via `.rpc()` instead of separate JS calls, so the whole
   sequence is one transaction: `approve_research()` (research approval),
   `claim_generation_run_task()` (per-subtask billing exclusivity),
   `record_login_attempt()` (rate limiting).
4. `src/app/admin/actions.ts` (AI model config) and
   `src/app/login/actions.ts` (the shared-password gate — needs the
   service-role client to sign the caller in as `OPERATOR_EMAIL` and to
   read/write `login_attempts`, which has RLS enabled with zero policies)
   are the only files that touch the Supabase service-role client
   (`src/lib/supabase/admin.ts`).

## AI architecture

`src/lib/ai/router.ts` — the Model Router — is the only place in the app
`research-actions.ts` / `content-actions.ts` reach to run an AI task. No
Server Action, page, or business-logic file calls a provider SDK directly.
See `docs/model-router.md` for the full multi-provider design; this
section covers what's provider-*specific*.

**Research has a Search Router in front of it now** (see
`docs/search-router.md`). `runResearchTask()` first tries
`src/lib/search/router.ts` — with Tavily configured (the free,
Development Mode default), it retrieves real sources first and hands them
to the resolved AI model for analysis only (no native grounding tool
call). If no search provider is configured at all, it falls through to
the native-grounding paths described below, unchanged. This is what
actually unblocked the first real Research run — Google's native
`googleSearch` grounding quota turned out to be far tighter than plain
generation on a free-tier key.

**Anthropic** (`src/lib/ai/research-agent.ts` / `content-agent.ts`) —
unchanged by either the Model Router or Search Router milestone,
byte-for-byte:

1. `runResearchAgent(topic)` calls the Anthropic Messages API with the
   server-side `web_search` tool enabled — Claude performs real web
   searches within that single call (no client-side search loop to write).
2. The model's final reply is parsed as JSON (`research-pack.ts` →
   `parseResearchPackJson`), then every claimed source is checked against
   the *actual* search results the tool returned in that response
   (`groundSources`) — anything not backed by a real result is dropped.
   This is the anti-hallucination guarantee, enforced in code, and it's
   provider-agnostic — see below for how Google reuses it.
3. Content generation uses Anthropic **structured outputs**
   (`client.messages.parse` + `zodOutputFormat`). Four independent
   generation functions (video, Xiaohongshu, WeChat outline, WeChat full
   article) each build an evidence context block, call the model,
   re-validate with Zod, resolve cited source labels back to real
   `research_sources.id` values, and scan for forbidden hype phrases.

**Google Gemini** (`src/lib/ai/providers/google-provider.ts`) — research
uses Gemini's `googleSearch` grounding tool; the returned grounding chunks
are mapped into the same `RealSearchResult` shape the Anthropic path
produces, so `research-pack.ts`'s `buildGroundedPack` applies the
*identical* anti-hallucination check regardless of provider. Content
generation uses `responseMimeType: "application/json"` (no schema
enforcement at the API level — Zod validates on the way back, same as
every other provider).

**Groq / OpenRouter** (`groq-provider.ts` / `openrouter-provider.ts`) —
JSON-mode structured generation only; neither has a registered
web-search-capable model, and neither participates in the Search Router
path either, so the Router never selects them for `RESEARCH` (enforced by
`isModelSuitableForTask`, not by convention).

**OpenAI** (raw HTTP, Chat Completions JSON mode — no dedicated
`openai-provider.ts`-style SDK wrapper needed) — no native web-search or
vision capability of its own, so it can never satisfy the native-grounding
research path or `PERFORMANCE_ANALYSIS`. It **can** be selected for
`RESEARCH`, but only via the Search Router path (a Search Provider
retrieves real sources first, OpenAI only analyses them via structured
output) — see `docs/search-router.md` and
`src/lib/ai/providers/registry.ts`'s OpenAI section for the exact split.
No free tier; every OpenAI model is registered `PAID` and not
`developmentRecommended`, so Development Mode's free-first routing never
auto-selects one — an ADMIN must explicitly set it as the default in
`/admin/ai-models`.

**The result, every provider**: logged to `ai_usage_log` unconditionally
(now including `provider`/`task_type`/`digital_employee`/
`pricing_type_at_execution`), grounded pack/content saved on success. Each
provider requires its own env var (see `.env.example`); an unconfigured
provider fails fast with a clear inline message rather than a stack trace.
`research-pack.ts` / `content-schemas.ts` have no such dependency and no
`"server-only"` import, which is what makes their parsing/grounding logic
directly unit-testable — and shareable across every provider. See
`docs/phase-4-plan.md` for the original Content Agent design and
`docs/data-model.md` for `content_assets`.

## Demo-data fallback

Per the Phase 1 instruction that page content can use demo values, every
page's data-fetch is wrapped so that if Supabase isn't configured yet (no
`.env.local`) or a query fails, the page renders static content from
`src/lib/demo-data.ts` instead of crashing, with a small inline notice.
This means `npm run dev` produces a working UI immediately, before any
Supabase project is connected. Once real credentials are set, live data is
used automatically — there is no separate "demo mode" toggle to maintain.
The same idea extends to AI: without at least one AI provider's API key
configured, "运行研究"/"生成内容" are disabled with an inline notice rather
than failing; `demo-data.ts` also ships one placeholder research pack
purely so the review UI has something to look at without spending API
credits (clearly labeled as such).

## Minimal UI principles

- Plain text, generous whitespace, one accent color, no shadows/gradients,
  no icon libraries.
- No client-side state management library — Server Components + Server
  Actions + `useState` where strictly needed (e.g. a text input) is enough
  at this scale.
- No animation, no modal stacks, no toasts beyond what's built into the
  browser/Next.js by default.
- The Topic Detail page's tabs (`src/components/content/topic-tabs.tsx`)
  are the one piece of client-side UI state in the app beyond a single
  text input — a plain `useState` tab switcher, no routing, no animation.
  Version history within a tab uses the native `<details>` element instead
  of any client-side toggle state, by preference.
