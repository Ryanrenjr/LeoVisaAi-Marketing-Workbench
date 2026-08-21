# Multi-provider AI Model Router

This is a **UI/architecture milestone on top of the existing AI
features**, not a new AI capability. Research and Content generation
behave exactly as before when the resolved provider is Anthropic — this
milestone adds the ability to route each *task* to a *different*
provider/model, and to prefer free-tier models during development.

## The product principle: Digital Employee ≠ Model

A digital employee (A 选题策划员 / B 政策研究员 / C 内容编辑 / D 合规审核员 / E 数据分析员) is
**never permanently tied to one AI model**. The real chain is:

```
Digital Employee → Task Type → Model Router → Provider → Model
```

Example: C 内容编辑 can generate 视频号 with one model, 小红书 with another,
and 公众号 with a third — three tasks, three independent routing decisions,
one employee. Do not write code like `ContentAgent = Claude` — always
route through a task type.

## Task types

Defined in `src/lib/ai/providers/types.ts`:

| Task type | Digital employee | Requires |
|---|---|---|
| `TOPIC_PLANNING` | A 选题策划员 | structured output (not wired to any business logic yet — see "What's prepared but not built" below) |
| `TOPIC_DISCOVERY` | A 选题策划员 | structured output — real news search (`src/lib/ai/topic-discovery.ts`) → candidate topics, never auto-written to `topics` |
| `RESEARCH` | B 政策研究员 | **real web-search capability** (hard requirement — see below) |
| `VIDEO_WRITING` | C 内容编辑 | structured output |
| `XIAOHONGSHU_WRITING` | C 内容编辑 | structured output |
| `WECHAT_WRITING` (outline) | C 内容编辑 | structured output |
| `WECHAT_FULL_ARTICLE` | C 内容编辑 | structured output |
| `COMPLIANCE` | D 合规审核员 | structured output — live; re-checks generated content against its own Research Pack (`src/lib/ai/compliance-schemas.ts`), advisory only |
| `PERFORMANCE_ANALYSIS` | E 数据分析员 | structured output + **vision** (reads a screenshot — hard requirement, see `supportsVision` in the registry) |

## Providers

`ANTHROPIC`, `GOOGLE`, `GROQ`, `OPENROUTER`, `OPENAI` — `src/lib/ai/providers/`:

- `anthropic-provider.ts` — a thin **adapter**, not a reimplementation.
  Delegates straight to the existing, untouched `research-agent.ts` /
  `content-agent.ts`. Their behavior, prompts, and tests are unchanged by
  this milestone.
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
- `openai-provider.ts` — real calls via raw HTTP (Chat Completions, JSON
  mode), same shape as `openrouter-provider.ts`. Uses the user's own
  OpenAI account/billing — no free tier, so both registered models are
  `PAID` and not `developmentRecommended`; an ADMIN must explicitly set
  one as the default for a task. No web-search or vision path wired yet,
  so it never satisfies RESEARCH or PERFORMANCE_ANALYSIS.

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

### RESEARCH's hard capability requirement

`isModelSuitableForTask()` rejects any model without
`supportsWebSearch: true` for `RESEARCH` — enforced by the registry filter
itself, not by convention. An override that violates this returns exactly
`"此模型不支持当前研究流程所需的联网能力。"` before any network call. The
Research Agent never falls back to answering from model memory alone.

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

See `docs/provider-smoke-test.md` for the end-to-end verification pass —
migration applied, both Google and Groq connected and health-checked
live, a real Research Agent run (revealed a real free-tier grounding
quota limit, reported honestly rather than worked around), and a
Model Registry audit that found **two separate stale-model-ID issues from
real API calls, not assumptions**: Groq's `llama-3.3-70b-versatile` /
`qwen/qwen3-32b` (deprecated, replaced with `openai/gpt-oss-120b` /
`openai/gpt-oss-20b`) and Google's `gemini-2.5-flash` /
`gemini-2.5-flash-lite` (rejected live for new API keys, replaced with
`gemini-3.6-flash` / `gemini-3.5-flash-lite`) — both fixes confirmed
working with real calls as of 2026-08-20.

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
