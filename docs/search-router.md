# Search Router (Tavily → analysis model)

This milestone separates **retrieving evidence** from **reasoning about
it** for the Research Agent. It does not add a new AI capability — B
政策研究员 still produces the same `research_packs`/`research_sources` rows
through the same human-approval-gated workflow. See `docs/model-router.md`
for the sibling AI-model abstraction this complements.

## Search Provider ≠ AI Model

The Model Router already separates Digital Employee → Task Type →
Provider → Model. This adds a parallel, independent abstraction for
Research specifically:

```
Research Task → Search Router → Search Provider → Retrieved Sources → Model Router → AI Model → Research Pack
```

Do not write code that couples a search provider to a specific AI model
(`GeminiResearchAgent`, `TavilyResearchAgent`). `src/lib/search/` knows
nothing about AI models; `src/lib/ai/router.ts` orchestrates both
independently for the RESEARCH task.

## Current development stack (as of 2026-08-20)

| Concern | Provider | Pricing |
|---|---|---|
| Search | **Tavily** | FREE — 1,000 credits/month, no card required |
| Research analysis | **Google Gemini** | FREE tier (plain generation; grounding tool not used on this path) |
| Content (视频号/小红书/公众号) | **Google / Groq** | FREE tier |
| Compliance | not implemented | — |

No paid provider is required to run the full development smoke test.

## Why search and reasoning are separated

Before this work, Research had exactly two paths, both bundling search
and reasoning into one API call: Anthropic's `web_search` tool, or
Google's `googleSearch` grounding tool. Google's grounding quota turned
out to be far tighter than plain generation on a free-tier key (confirmed
live — see `docs/provider-smoke-test.md`), which blocked the first real
Research run. Separating the two lets Research retrieve evidence through
an independent search provider, while still using Gemini (or any other
capable model) purely for reasoning over that evidence — reasoning quota
and search quota no longer compete, and search-provider cost is no longer
entangled with model cost either.

## Architecture

```
src/lib/search/
  types.ts              SearchProviderId, SearchResult, SearchExecutionResult — pure
  registry.ts            the Search Provider Registry — pure, single source of truth
  search-selection.ts     pure selection logic — mirrors model-selection.ts exactly
  router.ts               async orchestration: resolves a provider, runs every
                           query, classifies failures — server-only
  search-health.ts         ADMIN-only real connectivity check — server-only
  providers/
    tavily-provider.ts       real Tavily Search API implementation — server-only
    brave-provider.ts        real Brave Search API implementation — server-only

src/lib/ai/
  research-queries.ts      pure: derives up to 3 search queries from topic context,
                            ranks results toward primary sources
  research-external.ts      pure: the external-search Research prompt, Zod schema,
                             label-manifest (S1/S2...), and anti-hallucination
                             grounding — mirrors content-schemas.ts's pattern
  router.ts                 (extended) runResearchTask() tries the Search Router
                             first, dispatching the resolved AI model via
                             structured (non-native-grounding) generation
```

No file outside `src/lib/search/` and `src/lib/ai/research-*.ts`/`router.ts`
should import a search provider SDK directly.

## Search Provider Registry

`src/lib/search/registry.ts` → `SEARCH_PROVIDER_REGISTRY`. Two providers
registered: **`TAVILY`** (`FREE`, the Development Mode default) and
**`BRAVE`** (`PAID` — see "Brave: registered but not preferred" below).
`EXA`, `GOOGLE_GROUNDING`, and `ANTHROPIC_WEB_SEARCH` are deliberately
**not** registered — see "How to add a future Search Provider" for why
native Google/Anthropic grounding is handled differently rather than
modeled as a Search Provider entry.

Metadata per provider: `displayName`, `enabled`, `supportsDomainFiltering`,
qualitative `pricingType` (`FREE`/`PAID`/`MIXED`, same meaning as the
Model Registry — "currently configured as a known free-tier option," not
a permanent guarantee), `freeTierNote`, `lastVerifiedAt`.

### Brave: registered but not preferred

Brave removed its free API tier in 2026-02 — confirmed live on
2026-08-20 via the developer dashboard ("No subscriptions found...
subscribe to a plan before generating API keys"). Now pay-as-you-go only
(~$5 prepaid credit, $0.003–0.005/query, no free plan). Its
implementation is complete and tested — kept registered as an available,
not-currently-preferred alternative, per "do not spend time polishing it,
but don't leave it presented as a free option either." Development
Mode's free-first selection never reaches it (Tavily is `FREE`, found
first); using Brave requires an explicit `executionOverride: "BRAVE"` —
no UI control for this yet.

## Search Router selection (no silent fallback)

`src/lib/search/search-selection.ts` → `selectSearchProvider()`, pure,
same precedence as the Model Router: execution override → configured
default (not persisted anywhere yet — see "Future improvements") →
Development Mode free-first (the first enabled `FREE` provider — Tavily).
**No automatic FREE → PAID fallback**: if Tavily is unavailable, selection
does not silently reach for Brave.

`src/lib/search/router.ts` → `runResearchSearch(queries)` runs every
query against the resolved provider **in sequence, stopping at the first
failure** — never burning quota on queries after one has already failed.
Distinguishes:

- `SEARCH_PROVIDER_NOT_CONFIGURED` — no API key set.
- `SEARCH_RATE_LIMITED` — a real call failed with a 429/rate-limit signal.
- `SEARCH_QUOTA_EXCEEDED` — a real call failed with a quota/credit-exhaustion signal (distinct from a transient rate limit — Tavily's free tier is a *monthly* credit budget, not a per-second limit).
- `SEARCH_FAILED` — any other real failure (network, malformed response).
- `SEARCH_ROUTER_UNRESOLVED` — the Router itself couldn't resolve a
  provider (outside Development Mode with no configured default).

## How the native Google/Anthropic search path stays supported

`runResearchTask()` in `src/lib/ai/router.ts`:

1. Builds up to 3 queries from the topic, runs them through the Search Router.
2. If the Search Router never actually reaches a provider —
   `SEARCH_PROVIDER_NOT_CONFIGURED` or `SEARCH_ROUTER_UNRESOLVED` — it
   **falls through to the original native-grounding path**
   (`runAnthropicResearch` / `runGoogleResearch`, byte-for-byte unchanged).
   Not a "paid fallback": both paths stay within the free tier. This is
   how Google's native grounding stays reachable without deleting any
   code — it's just no longer the *default* once Tavily is configured.
3. If a search provider **is** actually contacted and a real call fails
   (rate limited, quota exceeded, network — any of
   `SEARCH_RATE_LIMITED`/`SEARCH_QUOTA_EXCEEDED`/`SEARCH_FAILED`), there
   is **no fallback** — the failure is returned exactly as it happened.
   Once a search provider is genuinely in use, a failure must not
   silently and invisibly become "oh, it just used something else
   instead" — ADMIN needs to see and act on the real problem (e.g. wait
   for Tavily's monthly quota to reset, or explicitly choose to spend
   money on Brave).

## Search → Model handoff

Once Tavily returns real results, the flow mirrors Content Agent's
label-manifest pattern (`research-external.ts` mirrors
`content-schemas.ts`) rather than the native path's self-reported-URL
pattern — because here the model receives *pre-fetched* evidence instead
of running its own search tool:

1. `buildSearchResultManifest()` labels each real result `S1`, `S2`, ...
2. The model (via `generateGoogleStructured`, or any provider's
   equivalent — including `generateAnthropicStructured`, so Anthropic can
   serve as the analysis model too) receives only the manifest, never a
   real URL to browse or invent from.
3. It must cite evidence **only** by label in `source_references`.
4. `buildExternalGroundedPack()` resolves each cited label back to the
   real Tavily result. **Any label not in the manifest is dropped, never
   resolved into a fabricated source** — the exact same guarantee
   `groundContentSources` gives Content Agent, applied one step earlier.
   Gemini does **not** call its own native `googleSearch` grounding tool
   on this path — it only ever sees the text prompt built from the
   manifest, and the system prompt explicitly forbids answering from
   memory, inventing rules/dates/paragraph numbers/URLs.

### Query strategy

`buildResearchQueries()` derives **up to 3** queries (a deliberately tight
smoke-test-stage budget, not a research-depth ceiling) from topic title,
question, business, and audience, via a **deterministic template** — not
an extra LLM call, so it never spends model quota deciding what to search
for. Results across all queries are pooled and re-ranked
(`rankSearchResults`) to put `gov.uk`/`legislation.gov.uk`/
`parliament.uk`/`gov.scot`/`immigrationadviceauthority.gov.uk` results
first, **without discarding secondary sources** — they can still help the
model triangulate.

Tavily's native `include_domains` parameter is wired into
`tavily-provider.ts` (`RunTavilySearchOptions.includeDomains`) but not
currently applied by default — its "prioritize vs. hard-filter" behavior
wasn't independently confirmed, and a hard filter risks silently zeroing
out results for a query where the real answer lives outside the listed
domains. Text-embedded hints (`"${base} gov.uk"`) plus post-retrieval
ranking achieve the same practical prioritization without that risk. Safe
to revisit once Tavily's exact `include_domains` semantics are confirmed.

### The snippet-only limitation

Tavily (like every search API here) returns titles and short content
snippets, not the full page. There is no page-fetching step this
milestone — deliberately: a safe, sandboxed fetcher (HTTP/HTTPS only,
size/timeout limits, no SSRF, text/html only, no JS execution, no headless
browser) was assessed as unnecessary complexity for the current
smoke-test milestone. Instead, `EXTERNAL_RESEARCH_SYSTEM_PROMPT`
explicitly instructs the model not to claim it has read a full document,
and `buildExternalGroundedPack()` **always** appends a disclosure note to
`warnings` regardless of confidence: "本次研究基于搜索结果标题与摘要生成，AI 未完整阅读原始网页全文".

## Search usage logging

A `search_usage_log` table (migration `0007_search_router.sql`), **not**
an extension of `ai_usage_log`: a search call has no
model/tokens/pricing-per-call semantics — its unit of "usage" is queries,
not tokens. Records: `provider`, `digital_employee`, `task_type`,
`topic_id`, `query_count`, `result_count`, `latency_ms`, `success`,
`error`, `created_at`. Written by `research-actions.ts` (via
`writeSearchUsageLog` in `src/lib/ai/usage-log.ts`, same reliability
pattern as `writeUsageLog`) whenever the Search Router actually ran — i.e.
`searchMeta !== null`; the native-grounding fallback writes nothing here
since no separate search step happened. One Research execution's two logs
together show the full picture: `search_usage_log` ("搜索：Tavily") and
`ai_usage_log` ("分析：Google/gemini-...").

## Error handling

Boss Mode never sees any of this — it shows only 正常工作/需要管理员处理-style
summaries, unchanged. Admin Mode sees the precise message from whichever
error path fired (distinct strings, not a single generic "AI 失败"):
`SEARCH_PROVIDER_NOT_CONFIGURED`/`SEARCH_RATE_LIMITED`/
`SEARCH_QUOTA_EXCEEDED`/`SEARCH_FAILED` propagate through
`research_runs.error` and `topic_activity_log` exactly like model-side
failures already did. `INSUFFICIENT_EVIDENCE` isn't an error code — an
under-supported claim surfaces as `confidence: LOW/MEDIUM` plus a
`warnings` note, the same mechanism the native path already uses.

## Admin settings

`/admin/ai-models`: "搜索服务连接状态" lists both providers (已连接/未配置, key
never shown, each with a real ADMIN-triggered health-check button), and
inside B 政策研究员's RESEARCH row, a line making "搜索资料 ≠ 分析资料" explicit
— which search service will run, separate from which model analyses the
results.

## Privacy

Same boundary as `docs/security-boundaries.md`: free (or, for Brave,
low-cost pay-as-you-go) search/AI tiers are for public policy research,
topic planning, and marketing content only — never real client
information. Both Tavily and Brave are third-party search indexes;
queries sent to either should stay at the same "public policy question"
level of generality the rest of this app already enforces.

## How to add a future Search Provider (e.g. Exa)

1. Add the id to `SearchProviderId` in `search/types.ts`.
2. Create `search/providers/<name>-provider.ts` exposing a function
   matching `runTavilySearch`'s shape: `(query, options?) => Promise<SearchExecutionResult>`.
3. Register it in `search/registry.ts` with accurate metadata.
4. Add one dispatch branch in `search/router.ts`'s `runResearchSearch`.
5. Add its env var to `.env.example` and the registry's env-var map.
6. Add a `checkSearchProviderHealth` dispatch entry in `search-health.ts`.

## How to add native grounding as a selectable Search Provider (future)

Modeling `GOOGLE_GROUNDING`/`ANTHROPIC_WEB_SEARCH` as Search Provider
Registry entries was considered and deferred: unlike Tavily/Brave, they
don't cleanly separate "retrieve sources" from "reason about them" — the
native tools do both in one API call, so a `SearchResult[]` step in
between doesn't naturally exist. If wanted later, the cleanest path is
likely a distinct "search strategy" concept (native vs. external) rather
than forcing native grounding through the `SearchProviderRegistryEntry`
shape, which assumes a pure retrieval step.

## Future improvements (explicitly out of scope)

- A conservative, sandboxed official-page fetcher for higher-confidence
  claims (see "The snippet-only limitation" above).
- A persisted `search_routing_config` default (mirrors `model_routing_config`)
  and a UI control for the task-level search-provider override (would let
  ADMIN choose Brave for one run without a code-level override).
- Confirming Tavily's `include_domains` prioritize-vs-filter semantics and
  wiring it in if safe.
- Exa, or any other additional Search Provider.
- Automatic full-page verification, vector search/RAG, a search-result cache.
