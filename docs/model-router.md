# Multi-provider AI Model Router

This is a **UI/architecture milestone on top of the existing AI
features**, not a new AI capability. Research and Content generation
behave exactly as before when the resolved provider is Anthropic — this
milestone adds the ability to route each *task* to a *different*
provider/model, and to prefer free-tier models during development.

## The product principle: Digital Employee ≠ Model

A digital employee (see `src/lib/boss-language.ts` `DIGITAL_EMPLOYEES` for
the current A–K roster) is **never permanently tied to one AI model**. The
real chain is:

```
Digital Employee → Task Type → Model Router → Provider → Model
```

Example: C 内容编辑 (视频号) and F 公众号编辑 (公众号) can each be routed to a
different provider/model — independent routing decisions per task type,
not one model shared across every employee. Do not write code like
`ContentAgent = Claude` — always route through a task type.

## Task types

Defined in `src/lib/ai/providers/types.ts` — kept in sync with the current
digital-employee roster (`src/lib/boss-language.ts`). `PERFORMANCE_ANALYSIS`
(the old E/J 数据分析员 task) no longer exists — that employee was retired
entirely by live user instruction; do not re-add it without a new explicit
instruction.

| Task type | Digital employee | Requires |
|---|---|---|
| `TOPIC_PLANNING` | A 选题策划员 | structured output (not wired to any business logic yet — see "What's prepared but not built" below) |
| `TOPIC_DISCOVERY` | A 选题策划员 | structured output — real news search (`src/lib/ai/topic-discovery.ts`) → candidate topics, never auto-written to `topics` |
| `RESEARCH_QUERY_PLANNING` | B 政策研究员 (infrastructure, not the Skill-governed role) | structured output — Round 4C's narrow Query Planner: rewrites the topic into English search queries before Search runs; never researches, cites, or answers anything. Does NOT use `buildSkillPrompt("researcher", ...)`. See `docs/search-router.md` "Research Query Planner" |
| `RESEARCH` | B 政策研究员 | structured output only — see "RESEARCH's capability requirement" below, the hard `supportsWebSearch` gate applies only to the native-grounding fallback, not the default Search Router path |
| `VIDEO_WRITING` / `VIDEO_REVISION` | C 内容编辑 | structured output |
| `XIAOHONGSHU_WRITING` / `XIAOHONGSHU_REVISION` | D 小红书文案员 | structured output |
| `XIAOHONGSHU_PAGES_PLANNING` / `XIAOHONGSHU_PAGES_REVISION` | K 小红书图文规划员 | structured output |
| `WECHAT_WRITING` / `WECHAT_FULL_ARTICLE` | F 公众号编辑 | structured output — legacy pre-`WECHAT_ARTICLE_WRITING` task types, kept but not the live default path |
| `WECHAT_ARTICLE_WRITING` / `WECHAT_ARTICLE_REVISION` | F 公众号编辑 | structured output |
| `COMPLIANCE` | G 合规审核员 | structured output — live; re-checks generated content against its own Research Pack (`src/lib/ai/compliance-schemas.ts`), advisory only. Also covers H 终审修改员's post-revision final re-check — both reuse this same task type, there is no separate `FINAL_COMPLIANCE` type |
| `IMAGE_GENERATION` | E 图片设计员 | the Images API capability (`supportsImageGeneration`), a different endpoint shape from every other task |

## Providers

`ANTHROPIC`, `GOOGLE`, `GROQ`, `OPENROUTER`, `OPENAI` — `src/lib/ai/providers/`:

- `anthropic-provider.ts` — a thin **adapter**, not a reimplementation.
  Delegates to `research-agent.ts` / `content-agent.ts`, passing through
  the Router's resolved `modelId` as an explicit parameter (fixed in
  Round 2 — these previously ignored it and always called a hardcoded
  `MODEL_ALIAS` / `claude-opus-5`, so picking Claude Sonnet 5 in
  `/admin/ai-models` for e.g. `COMPLIANCE` could silently still run Opus
  5). `research-agent.ts` / `content-agent.ts` fall back to their own
  `RESEARCH_MODEL` / `CONTENT_MODEL` env vars only when called directly
  with no `modelId` — a legacy path for non-Router callers, not something
  the Router itself relies on. Prompts and grounding/anti-hallucination
  behavior are otherwise unchanged.
- `google-provider.ts` — real Gemini calls (`@google/genai`). Research
  uses Gemini's `googleSearch` grounding tool; its grounding chunks are
  mapped into the same shape the Anthropic path produces, so the
  *identical* `research-pack.ts` anti-hallucination check applies
  regardless of provider. Content generation uses JSON-mode output,
  re-validated with the caller's Zod schema.
- `groq-provider.ts` — real Groq calls (`groq-sdk`), JSON mode. No
  registered Groq model claims web-search capability.
- `openrouter-provider.ts` — real calls via raw HTTP (no dedicated
  OpenRouter SDK exists). Experimental / A-B testing surface. No
  registered OpenRouter model claims web-search capability.
- `openai-provider.ts` — real calls via raw HTTP: Chat Completions
  (`json_schema` strict mode, re-validated with the caller's Zod schema)
  for every text task, plus a separate Images endpoint (`gpt-image-2`) for
  `IMAGE_GENERATION`. Registers the GPT-5.6 family — `gpt-5.6-sol`
  (flagship, `reasoningEffort: "high"`, production default for
  `RESEARCH`), `gpt-5.6-terra` (balanced, `reasoningEffort: "medium"`,
  production default for the content/revision/topic-discovery tasks — see
  "Production routing" below), and `gpt-5.6-luna` (cost-optimized,
  registry-only — not a production default for any task) — confirmed
  against `developers.openai.com/api/docs/models/all` on 2026-09-15. Uses
  the user's own OpenAI account/billing — no free tier, so every OpenAI
  entry is `PAID` and not `developmentRecommended`; an ADMIN must
  explicitly set one as the default for a task. No native web-search or
  vision-analysis path wired, so it never satisfies the native-grounding
  RESEARCH fallback (see below) — but an OpenAI model can and does serve
  RESEARCH via the Search Router path, since that path only needs
  structured output.

The rest of the application **never** imports a provider SDK or calls
these files directly — only `router.ts` does.

## The Model Registry — single source of truth

`src/lib/ai/providers/registry.ts` → `MODEL_REGISTRY`. Every model's
metadata (pricing type, capabilities, dev-mode recommendation, notes)
lives here and nowhere else. Do not hard-code a model id or pricing
assumption anywhere else in the codebase — always look it up via
`getModel()` / `listModelsForTask()`.

### Pricing is qualitative, not a hard-coded price

`pricingType` is `FREE` / `PAID` / `MIXED` — meaning "currently configured
as a known free-tier option" / "normally incurs charges" / "free
allowance may exist but this execution may incur cost." Never a USD
figure. Every entry also carries `freeTierNote`, `pricingNote`, and
`lastVerifiedAt` (a snapshot date, not a live lookup) — because provider
pricing changes frequently and this app must never claim permanent
accuracy. Boss Mode never shows any of this; it's an ADMIN-only concern
(`/admin/ai-models`).

## The Router's selection logic (no silent fallback)

`src/lib/ai/model-selection.ts` → `selectModel()`, pure and fully
unit-tested. Precedence, highest to lowest:

1. **Execution override** — the ADMIN's one-off "更换本次模型" choice for
   this single click (see below). Must satisfy the task's capability
   requirement or the call is rejected before any provider is contacted.
2. **ADMIN's persisted default** — set per task type in `/admin/ai-models`,
   stored in `model_routing_config`. An explicit choice always wins over
   automatic behavior.
3. **Development Mode free-first** (`AI_DEVELOPMENT_MODE=true`) — the
   first enabled, `developmentRecommended`, `FREE` model that satisfies
   the task. **If none exists, the task fails** with exactly:
   `"免费模型当前不可用，请选择其他模型。"` — never a silent switch to a paid
   model.
4. **No default, Development Mode off** — the task fails with
   `"尚未为该任务配置默认模型，请在「AI 模型配置」中设置。"`, asking for an
   explicit ADMIN decision rather than guessing.

`src/lib/ai/router.ts` wraps this with the async parts (reading
`AI_DEVELOPMENT_MODE`, fetching the persisted default) and dispatches to
the resolved provider. A resolution failure never contacts any provider —
`RouterResolutionFailure` (`provider: null`) is distinguishable from a
provider that was actually called and failed
(`isRouterResolutionFailure()`).

### RESEARCH's capability requirement

`isModelSuitableForTask()` only requires `supportsStructuredOutput` for
`RESEARCH`, same as every other task — **not** `supportsWebSearch`. This
is deliberate: the live default path (Search Router retrieves real
sources first, the resolved model only analyses them via structured
output — see `runResearchTask` below) never calls the model's own search
tool, so an OpenAI model can serve `RESEARCH` there despite having no
native web-search capability. `supportsWebSearch` still gates the
separate native-grounding fallback (`runNativeResearchTask`, used only
when no search provider is configured) — that function itself checks
`model.provider === "ANTHROPIC" | "GOOGLE"` and returns exactly
`"此模型不支持当前研究流程所需的联网能力。"` for anything else, before any
network call. The Research Agent never falls back to answering from model
memory alone.

## Paid/mixed-cost warning

Whenever the *effective* model for a manually-triggered generation is
`PAID` or `MIXED`, the Topic Detail page's `<GenerateAction>` component
(`src/components/ai/generate-action.tsx`) shows an inline confirmation —
provider, model, task, 取消/继续运行 — **before** calling the Server Action.
Boss Mode never renders this component; model selection is exclusively an
ADMIN concern on the (already ADMIN-gated) Topic Detail page.

## Task-level temporary override

Every generation button lets ADMIN pick a different model for **this one
execution** via "更换本次模型," without changing the persisted default in
`/admin/ai-models`. The override is passed as a plain `{ provider,
modelId }` argument straight into the Server Action (calling it
programmatically from the Client Component, not via native form
encoding) — no new client-side state management, no new
FormData-encoding step. The actually-used provider/model is what gets
written to `ai_usage_log`, regardless of whether it came from a default
or an override.

## Admin settings — `/admin/ai-models`

Per task type, grouped by digital employee: current default (or "使用开发模式免费优先"),
a dropdown of every capability-suitable model with its provider + pricing
label + capability hint (e.g. "支持联网研究"), and a save button
(`setTaskModelDefault` in `src/app/admin/actions.ts` — the one file
allowed to import the Supabase service-role client, per
`docs/security-boundaries.md`). Also shows: each provider's connection
status (已连接/未配置 — **never** the key value), the current
Development Mode state, and the same free-model privacy notice as
`docs/security-boundaries.md`.

## Production routing (ACTIVE defaults)

Persisted in `model_routing_config` — bootstrapped by
`supabase/migrations/0032_model_routing_defaults_seed.sql` (`on conflict
do nothing`, fresh-environment only), brought to the Round 2 values by
`supabase/migrations/0034_model_routing_active_defaults.sql` (`on
conflict do update` — an intentional change to already-configured
production values, not just a bootstrap), and given `RESEARCH_QUERY_PLANNING`
its first default by `supabase/migrations/0035_model_routing_research_query_planning.sql`
(Round 4C — written but **not yet applied** to the live database; see
that migration's own comment). An ADMIN can still override any of these
in `/admin/ai-models`; this table is the deliberate product default, not
a hard-coded restriction.

| Task type | Provider / Model |
|---|---|
| `TOPIC_DISCOVERY` | OPENAI / `gpt-5.6-terra` |
| `RESEARCH_QUERY_PLANNING` | OPENAI / `gpt-5.6-terra` (Round 4C — migration not yet applied) |
| `RESEARCH` | OPENAI / `gpt-5.6-sol` (+ Query Planner + Search Router — see `docs/search-router.md`) |
| `VIDEO_WRITING` / `VIDEO_REVISION` | OPENAI / `gpt-5.6-terra` |
| `XIAOHONGSHU_WRITING` / `XIAOHONGSHU_REVISION` | OPENAI / `gpt-5.6-terra` |
| `XIAOHONGSHU_PAGES_PLANNING` / `XIAOHONGSHU_PAGES_REVISION` | OPENAI / `gpt-5.6-terra` |
| `WECHAT_ARTICLE_WRITING` / `WECHAT_ARTICLE_REVISION` | OPENAI / `gpt-5.6-terra` |
| `COMPLIANCE` | ANTHROPIC / `claude-sonnet-5` (also covers H's post-revision final re-check — same task type) |
| `IMAGE_GENERATION` | OPENAI / `gpt-image-2` |

Deliberately left untouched by 0034 (not part of the live pipeline):
`TOPIC_PLANNING` (no caller yet), `WECHAT_WRITING` / `WECHAT_FULL_ARTICLE`
(legacy pre-`WECHAT_ARTICLE_WRITING` task types).

**Why COMPLIANCE is a different provider family than content generation:**
content is authored on OpenAI (Terra), then reviewed by Anthropic (Sonnet
5) — cross-model independent review, so the same model family that wrote
a claim isn't also the one grading it. This is not a claim that Claude
"understands UK law better" — it's about reducing same-model blind spots
between author and reviewer. See `runComplianceTask` in `router.ts` and
the compliance-schemas.ts comments.

## What's prepared but not built

- **`TOPIC_PLANNING`** — registered as a task type so ADMIN can configure
  a default model for it ahead of time, but **no business logic invokes
  it**. Per `CLAUDE.md`, Topic AI *scoring* is out of scope until a later,
  explicit instruction — `TOPIC_DISCOVERY` (Employee A's news search) is a
  separate, already-implemented task type; it does not touch scoring.

## Relationship to the Search Router

RESEARCH is the one task type with a step before the Model Router even
runs: `src/lib/search/router.ts` first tries to retrieve real evidence
(Tavily Search, the Development Mode default), and only then does the
Model Router resolve an AI model to *analyse* that evidence — the model
does not run its own native search tool on this path. See
`docs/search-router.md` for the full design; the Model Router itself is
unaware this happens — it still just resolves "which model for the
RESEARCH task," exactly as for any other task.

## Verification status

See `docs/provider-smoke-test.md` for the original end-to-end
verification pass (2026-08-20) — migration applied, both Google and Groq
connected and health-checked live, a real Research Agent run (revealed a
real free-tier grounding quota limit, reported honestly rather than
worked around), and a Model Registry audit that found **two separate
stale-model-ID issues from real API calls, not assumptions**: Groq's
`llama-3.3-70b-versatile` / `qwen/qwen3-32b` (deprecated, replaced with
`openai/gpt-oss-120b` / `openai/gpt-oss-20b`) and Google's
`gemini-2.5-flash` / `gemini-2.5-flash-lite` (rejected live for new API
keys, replaced with `gemini-3.6-flash` / `gemini-3.5-flash-lite`).

**Round 2 audit (2026-09-15)** re-verified against each provider's
current official model list/docs before writing any code (not repo
comments):

- OpenAI GPT-5.6 family (`gpt-5.6-sol` / `-terra` / `-luna`) — confirmed
  GA via `developers.openai.com/api/docs/models/all`.
- Anthropic `claude-sonnet-5` — confirmed via
  `platform.claude.com/docs/en/about-claude/models/overview` ($2/$10 per
  MTok in/out, 1M context, structured output/vision/tool use).
- Google `gemini-3.8-flash` — confirmed GA/"New Stable" via
  `ai.google.dev/gemini-api/docs/models`; `gemini-3.6-flash` kept enabled
  as a secondary option (not deprecated), just no longer
  `developmentRecommended`.
- Google `gemini-3.5-flash-lite` — confirmed still GA with **no**
  deprecation/shutdown date on `ai.google.dev/gemini-api/docs/deprecations`;
  a previous note in this repo incorrectly claimed a 2026-10-16 shutdown
  and has been removed.
- OpenAI image models — found `gpt-image-2` now marked superseded on the
  official model list, with `gpt-image-2.5-sunburst` /
  `gpt-image-2.5-flare` as the current GA production tiers. Flagged to
  the live user rather than switched unilaterally; decision was to keep
  `gpt-image-2` as the `IMAGE_GENERATION` production default this round
  and defer evaluating the 2.5 family to its own dedicated round — see
  the comment above the `gpt-image-2` entry in `registry.ts`.
- Fixed a real correctness bug (not a model-list issue): the Router's
  resolved `modelId` for Anthropic content-generation and native-research
  tasks was being silently discarded in favor of a hardcoded
  `MODEL_ALIAS` (`claude-opus-5` / `CONTENT_MODEL` / `RESEARCH_MODEL`) —
  see `content-agent.ts`, `research-agent.ts`, `anthropic-provider.ts`.

## How to add a new model

Add one entry to `MODEL_REGISTRY` in `registry.ts` with accurate
capability flags and a qualitative pricing type. Nothing else needs to
change — the registry is the only place model ids are declared.

## How to add a new provider

1. Add the id to `AIProviderId` in `providers/types.ts`.
2. Create `providers/<name>-provider.ts` exposing whatever subset of
   `runResearch(topic, modelId)` / `generateStructured({...})` it can
   support (a provider with no web-search-capable model doesn't need a
   research function — the registry gates that).
3. Register its models in `registry.ts`.
4. Wire the two new dispatch branches into `router.ts`
   (`runResearchTask` / `dispatchStructured`).
5. Add its env var to `.env.example`,
   `providers/registry.ts`'s `PROVIDER_ENV_VAR`, and the provider-status
   list in `/admin/ai-models`.
