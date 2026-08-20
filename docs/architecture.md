# Architecture

## Stack

- **Framework**: Next.js 16 (App Router, TypeScript, React Server
  Components + Server Actions).
- **Styling**: Tailwind CSS v4. No component library — a handful of small,
  hand-written primitives in `src/components/ui/`, kept deliberately
  minimal.
- **Backend**: Supabase (Postgres + Auth). No separate backend service —
  authorization is enforced at the database layer via Row Level Security
  (RLS), and privileged operations (role changes) run through Next.js
  Server Actions using the Supabase service-role key, which never leaves
  the server.
- **AI**: multi-provider via the Model Router (`src/lib/ai/router.ts`) —
  Anthropic (`@anthropic-ai/sdk`), Google Gemini (`@google/genai`), Groq
  (`groq-sdk`), and OpenRouter (raw HTTP). No business logic calls a
  provider SDK directly; everything routes through task-type-based
  selection. Structured output validated with Zod regardless of provider.
  See "AI architecture" below, `docs/model-router.md`,
  `docs/phase-3-plan.md`, and `docs/phase-4-plan.md`.
- **Testing**: Vitest + React Testing Library.

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
    page.tsx              dashboard: stage counts, links into the library
    actions.ts            server actions for the legacy pipeline stages
    login/                public route
    topics/                the Topic Library (选题库)
      page.tsx             list of active (IDEA/RESEARCHING) topics
      new/page.tsx          create form
      actions.ts            create/update/rescore/start-research/archive
      research-actions.ts   run research, edit pack, approve, request changes
      content-actions.ts     generate/regenerate/edit content drafts, full article
      [id]/page.tsx          Topic Detail: tabs — 研究包/视频号/小红书/公众号/合规/记录
      [id]/edit/page.tsx     edit topic fields
      [id]/research/edit/    edit a research pack's narrative fields (ADMIN)
      [id]/content/[assetId]/edit/  edit a content draft (ADMIN, creates a new version)
    research-completed/   pipeline stage view (status RESEARCH_APPROVED)
    ready-to-shoot/        pipeline stage view
    published/             pipeline stage view, scoped to the current week
    admin/                 ADMIN-only: manage staff roles, view approval log
      ai-models/page.tsx     AI 模型配置 — per-task-type model default selection,
                              provider connection status, dev-mode indicator
  components/              presentational + small interactive components
    ui/                     generic primitives (button, etc.)
    content/                 platform-specific content views, tabs, shared bits
                              (expert-review-notes, content-sources, field)
  lib/
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
   `/login` itself and static assets).
2. Server Components (page.tsx files) read data directly from Supabase
   using the server client, which carries the caller's session — so every
   read is subject to that user's RLS policies, not a service role.
3. Mutations (create/edit a topic, advance status, run research, approve
   research, change a user's role) go through Server Actions in colocated
   `actions.ts` files. Actions re-check the caller's session/role before
   doing anything privileged; RLS is the backstop, not the only check.
4. Only `src/app/admin/actions.ts` touches the Supabase service-role
   client (`src/lib/supabase/admin.ts`), and only after confirming the
   caller is `ADMIN`. That file is the single place in the codebase
   allowed to import the service-role key.

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
web-search-capable model, so the Router never selects them for `RESEARCH`
(enforced by `isModelSuitableForTask`, not by convention).

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
