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
not a case file.

This also governs what the Research Agent is allowed to be told and asked
to produce — see "AI usage" below.

If a future instruction asks for something that would require storing any
of the above, treat that as a conflict with this document and flag it
before implementing.

### Leo's reference photos — the one narrow upload exception

**"No document upload feature anywhere in this app" has exactly one
exception, by explicit live user instruction:** `/team/image-designer`
accepts a photo upload of Leo himself, and ONLY this.

(An earlier exception existed for J｜数据分析员's post-performance
screenshot upload — that whole employee, its `publish_performance` table,
and its `publish-screenshots` storage bucket were retired by explicit live
user instruction, see `supabase/migrations/0024_remove_analyst_employee.sql`.
It is gone, not just hidden — do not resurrect `/team/analyst` or a
screenshot-upload surface from an old plan doc.)

- **What it's for:** an image-generation model can't reliably render a
  specific real person's likeness from a text prompt alone, and shouldn't
  be asked to guess at one from a description — so instead ADMIN uploads
  a real photo of Leo, which is passed as a reference image to the
  Images EDIT endpoint (`generateOpenAIImageEdit()` in
  `src/lib/ai/providers/openai-provider.ts`) alongside the cover prompt,
  so the model works his actual likeness into the generated 小红书/视频号
  cover when "带李尔王特写" is checked. The model is grounded in the real
  photo, never conjuring his face from a text description alone.
- **What it must never become:** a general document/photo upload. This
  surface exists for one specific real person (Leo, the company's own
  public-facing figure) whose photo is brand material he has already
  chosen to appear in publicly, never a client's photo, a case-related
  image, or anyone else's likeness. If a future request asks to upload a
  photo of anyone else, or anything beyond a portrait/headshot photo,
  through this or any other surface, treat that as a conflict with this
  document and flag it before implementing.
- **Storage:** a private Supabase Storage bucket (`leo-portraits`,
  `public: false`) plus a `leo_portraits` metadata table, both ADMIN-write
  / staff-read via RLS — see
  `supabase/migrations/0017_leo_portraits.sql`. Read access always goes
  through a short-lived signed URL (`getLeoPortraitSignedUrl()` in
  `src/lib/leo-portraits.ts`), never a public link.
- **Validation:** `uploadLeoPortrait()`
  (`src/app/team/image-designer/actions.ts`) rejects anything that isn't
  `image/png`, `image/jpeg`, or `image/webp`, and anything over 8MB.

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
- **AI provider keys** (`ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY`,
  `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`): same rules as the service role
  key. Never prefix with `NEXT_PUBLIC_`. Each is only read inside its
  matching `src/lib/ai/providers/*-provider.ts` file (or, for Anthropic,
  `research-agent.ts`/`content-agent.ts`), all `"server-only"`. No
  business-logic file, page, or Client Component ever imports a provider
  SDK or reads these env vars directly — every call goes through
  `src/lib/ai/router.ts`. Only Server Actions
  (`src/app/topics/research-actions.ts`, `content-actions.ts`) trigger a
  call, and only after checking the caller's role
  (`canRunResearch`/`canManageContentAssets`) *and* the topic's status
  gate. `/admin/ai-models` shows each provider as "已连接"/"未配置" —
  **never** the key value itself; there is no reveal button anywhere.
- **`TAVILY_API_KEY`** / **`BRAVE_SEARCH_API_KEY`**: same rules — server-side
  only, never `NEXT_PUBLIC_`, only read by their matching
  `src/lib/search/providers/*-provider.ts` file, never logged or rendered
  into HTML. Every call goes through `src/lib/search/router.ts`, reached
  only from `src/lib/ai/router.ts`'s Research flow. `/admin/ai-models`'s
  "搜索服务连接状态" shows "已连接"/"未配置" only, same as the AI provider keys.
- No API key (of any kind) is ever passed as a prop into a Client
  Component, embedded in a data attribute, or logged.

### Free-tier AI models — an additional data boundary

Free-tier models (see `docs/model-router.md`) may be operated by a third
party under different data-handling terms than Anthropic's paid API —
some free tiers permit the provider to use requests to improve their own
models. This does **not** change the rule above ("no real client
information ever enters a prompt") — it makes it more load-bearing:

- Free models are for **public policy research, topic ideation, and
  marketing content experimentation only**.
- Never send passport data, dates of birth, addresses, bank information,
  refusal letters, case numbers, or any real client file through *any*
  provider, free or paid — the same boundary as the rest of this document,
  reiterated to ADMIN directly in `/admin/ai-models`.
- This is a process/UI-education boundary, not a code-enforced filter —
  the same category of guarantee as "no individualized legal advice"
  below: reasonable to prompt-request and document, not mechanically
  verifiable from within this app.

## AI usage

`src/lib/ai/router.ts` is the only place in this app's business logic
that resolves and dispatches a model call — see `docs/model-router.md`.
Rules that apply to every provider it can route to, and to any future
provider added later:

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
- **Sources must be real, not fabricated — for every provider capable of
  research.** The grounding check (`groundSources` in `research-pack.ts`)
  cross-checks every claimed source against the actual search-tool
  results returned in that response — applied identically whether the
  search results came from Anthropic's `web_search` tool or Google's
  `googleSearch` grounding. Content generation never lets any provider see
  a real URL at all — sources are presented as numbered labels ("S1",
  "S2"), the model may only cite by label, and any label that doesn't
  match one actually given is dropped before resolving to a real
  `research_sources.id` (`groundContentSources` /
  `applyGroundingAndSafety`). All code-level guarantees with test
  coverage, not prompting requests. Grounding is enforced the same way
  regardless of *how* a model got its sources: either it has native
  web-search capability itself (Anthropic `web_search`, Google
  `googleSearch`), or the Search Router (see `docs/search-router.md`)
  retrieves real sources first and hands them to a model with no
  web-search capability of its own (e.g. OpenAI) for analysis only — a
  model is never allowed to reach `RESEARCH` with neither its own
  web-search nor a Search Router result behind it
  (`isModelSuitableForTask`).
- **Every model call is logged**, success or failure, to `ai_usage_log`
  (`workflow_type`, `model_alias`, `topic_id`, `platform` for content
  calls, token counts, latency, success/failure, timestamp, plus
  `provider`/`task_type`/`digital_employee`/`pricing_type_at_execution`
  as of the Model Router milestone) — see `docs/data-model.md`.
- **No automatic FREE → PAID fallback, ever.** If Development Mode can't
  find a free model that satisfies a task's requirements, the task fails
  with a clear message rather than silently reaching for a paid model.
  Choosing a paid/mixed-cost model is always an explicit, visible ADMIN
  action with a warning shown first. See `docs/model-router.md`.
- **Content generation is gated behind research approval, enforced
  server-side.** `canGenerateContent()` in `src/lib/permissions.ts`
  requires the topic's status to be `RESEARCH_APPROVED` or later; every
  content Server Action checks it directly (`loadGenerationContext` in
  `src/app/topics/content-actions.ts`) before calling Anthropic or writing
  any row — not only by hiding the button. See `docs/phase-4-plan.md`.
- **Compliance (Employee D) never issues a "compliant/approved"
  verdict.** `runComplianceTask()` re-checks already-generated content
  against the SAME approved Research Pack it was written from, plus a
  deterministic forbidden-phrase scan that runs regardless of what the
  model itself reports (`mergeComplianceFindings()` in
  `src/lib/ai/compliance-schemas.ts`). Its only output is findings for a
  human (`compliance_reviews` table) — it never sets `topics.status` or
  `content_assets.status`, and it is explicitly instructed never to use
  the word "compliant." This is not eligibility assessment or legal
  advice — it flags marketing-copy risk (unsupported claims,
  individualized-advice phrasing, hype language), the same category of
  check the Content Agent's own `expert_review_notes` already does, just
  as a second, independent pass.

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
**Note (2026-09, "工具化"):** this row still gets written, but it is no
longer a retained audit trail — see CLAUDE.md rule 4 and
[data-model.md](data-model.md)'s data-lifecycle note. A "淘汰" (discard) at
any step, and a session that reaches its final download, both end by
hard-deleting the `topics` row, which cascades this row away with it.
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

Live user instruction (2026-09): "不要分用户登录了，彻底变成一个一次性工具"
— there are no per-person accounts. Access is gated by a single shared
password (`SITE_PASSWORD`, checked in `src/app/login/actions.ts`, rate
limited per-IP via the atomic `record_login_attempt()` Postgres function —
see `supabase/migrations/0031_login_rate_limit_rpc.sql`); anyone who knows
it is transparently signed in as one fixed, pre-existing Supabase Auth
account (`OPERATOR_EMAIL`) via `admin.auth.admin.generateLink()` +
`supabase.auth.verifyOtp()`, never that account's real password.

- Sessions are still real Supabase Auth sessions, stored in httpOnly
  cookies via `@supabase/ssr`; no tokens are stored in `localStorage`.
- `src/proxy.ts` refreshes the session on every request and redirects
  unauthenticated requests away from protected routes; it also fails
  closed (503, not silent demo mode) if Supabase isn't configured but the
  app is running on Vercel, and checks the signed-in session's email
  actually matches `OPERATOR_EMAIL` before allowing access.
- Supabase Auth signup is disabled at the config level
  (`supabase/config.toml`'s `[auth]`/`[auth.email]` `enable_signup =
  false`) — this repo setting does not by itself confirm the hosted
  Supabase Dashboard's Auth settings match; that needs separate,
  independent verification against the live project.
- The `ADMIN`/`EXPERT` role field still exists in the data model
  (`profiles.role`, `src/lib/permissions.ts`) purely because the fixed
  operator account happens to be `ADMIN` — every permission/RLS check
  still technically runs, it just always resolves the same way now. There
  is no client-facing account type; the only authenticated identity
  possible is that one internal-staff account.

## Reviewing changes against this document

Any change that adds a new database column, a new upload capability, a new
integration, or a new externally-facing surface should be checked against
this document before merging. If in doubt, ask before storing it.
