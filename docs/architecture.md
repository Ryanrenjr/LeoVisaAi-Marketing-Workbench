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
- **AI**: Anthropic Messages API (`@anthropic-ai/sdk`), called only from
  `src/lib/ai/research-agent.ts` and `src/lib/ai/content-agent.ts`
  (server-only). Structured output validated with Zod. See "AI
  architecture" below, `docs/phase-3-plan.md`, and `docs/phase-4-plan.md`.
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
      research-agent.ts      orchestration: calls Anthropic, server-only
      research-pack.ts        pure parsing/grounding logic — no network,
                               no server-only import, fully unit-tested
      content-agent.ts         orchestration: calls Anthropic (structured
                                outputs via Zod), server-only
      content-schemas.ts        pure: Zod schemas, source-manifest/grounding,
                                 prompts — no network, fully unit-tested
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

`src/lib/ai/research-agent.ts` is the only place in the app that calls a
model — see `docs/phase-3-plan.md` for the full design. In short:

1. `src/app/topics/research-actions.ts` → `runResearch()` checks the
   caller is `ADMIN`, inserts a `research_runs` row, then calls
   `runResearchAgent(topic)`.
2. That function calls the Anthropic Messages API with the server-side
   `web_search` tool enabled — Claude performs real web searches within
   that single call (no client-side search loop to write).
3. The model's final reply is parsed as JSON (`research-pack.ts` →
   `parseResearchPackJson`), then every claimed source is checked against
   the *actual* search results the tool returned in that response
   (`groundSources`) — anything not backed by a real result is dropped.
   This is the anti-hallucination guarantee, enforced in code.
4. The result (success or failure) is logged to `ai_usage_log`
   unconditionally, and the grounded pack is saved to `research_packs` /
   `research_sources` on success.
5. `research-agent.ts` requires `ANTHROPIC_API_KEY`; `research-pack.ts`
   has no such dependency and no `"server-only"` import, which is what
   makes its parsing/grounding logic directly unit-testable.

### Content Agent

`src/lib/ai/content-agent.ts` follows the same server-only/pure-module
split, but calls the Anthropic API differently — no tool use is needed
(no web search), so it uses **structured outputs**
(`client.messages.parse` + `zodOutputFormat`) instead of Research Agent's
manual-JSON-in-text parsing. Four independent generation functions (video,
Xiaohongshu, WeChat outline, WeChat full article) each: build an evidence
context block from the topic + approved research pack + a source manifest
that labels sources ("S1", "S2"...) instead of showing real URLs, call the
model, re-validate the parsed result with Zod, resolve cited labels back
to real `research_sources.id` values (dropping anything unverified), and
scan the output for a short list of forbidden hype phrases — flagging
hits into `expert_review_notes` rather than blocking generation. See
`docs/phase-4-plan.md` for the full design and `docs/data-model.md` for
`content_assets`.

## Demo-data fallback

Per the Phase 1 instruction that page content can use demo values, every
page's data-fetch is wrapped so that if Supabase isn't configured yet (no
`.env.local`) or a query fails, the page renders static content from
`src/lib/demo-data.ts` instead of crashing, with a small inline notice.
This means `npm run dev` produces a working UI immediately, before any
Supabase project is connected. Once real credentials are set, live data is
used automatically — there is no separate "demo mode" toggle to maintain.
The same idea extends to AI: without `ANTHROPIC_API_KEY`, "运行研究" is
disabled with an inline notice rather than failing; `demo-data.ts` also
ships one placeholder research pack purely so the review UI has something
to look at without spending API credits (clearly labeled as such).

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
