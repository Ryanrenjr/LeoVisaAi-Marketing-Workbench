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
Research Task → Query Planner (Round 4C) → Search Router → Search Provider → Retrieved Sources → Model Router → AI Model → Research Pack
```

Do not write code that couples a search provider to a specific AI model
(`GeminiResearchAgent`, `TavilyResearchAgent`). `src/lib/search/` knows
nothing about AI models; `src/lib/ai/router.ts` orchestrates all three —
Query Planner, Search, and analysis — independently for the RESEARCH
task.

## What the Query Planner is (and is very much not)

**RESEARCH_QUERY_PLANNING** is a narrow, separate task type resolved
through the same Model Router as everything else — production default
`OPENAI`/`gpt-5.6-terra` (see `docs/model-router.md`), never a
hard-coded provider. Its only job: rewrite the Chinese (or bilingual)
research topic into three English retrieval queries, before Search ever
runs. It does **not** research, browse, cite evidence, judge policy
status, or produce anything resembling a Research Pack — see
`research-query-planner.ts`'s `RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT` for
the exact narrow contract. See "Research Query Planner" below for why it
exists and how it fails safely.

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
  extraction.ts            (Round 4) the official-source-extraction seam the
                            AI layer goes through — server-only
  providers/
    tavily-provider.ts       real Tavily Search + Extract API implementation — server-only
    brave-provider.ts        real Brave Search API implementation — server-only

src/lib/ai/
  research-query-planner.ts (Round 4C) pure: schema/prompt/conversion for the
                             narrow Query Planner AI call — no network, no Skill
  research-queries.ts      pure: derives up to 3 deterministic search queries
                            (the fallback path) from topic context, ranks
                            results toward primary sources, and (Round 4B)
                            selects which few official URLs are worth extracting
  research-external.ts      pure: the external-search Research prompt, Zod schema,
                             label-manifest (S1/S2... with an OFFICIAL_EXTRACT/
                             SEARCH_SNIPPET evidence type each), and
                             anti-hallucination grounding — mirrors
                             content-schemas.ts's pattern
  router.ts                 (extended) runResearchTask() tries the Query
                             Planner, falls back to deterministic queries on
                             any failure, runs the Search Router, then
                             (Round 4B) extracts real content for a
                             few top official sources, then dispatches the
                             resolved AI model via structured
                             (non-native-grounding) generation
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

### Research Query Planner (Round 4C)

Round 4B's hard `include_domains` filter genuinely restricts search to
official domains, but a re-test of the Returning Resident case showed
that alone still isn't enough: Tavily's own semantic ranking *within*
that domain-restricted set didn't favor the actually relevant GOV.UK page
for the Chinese-language question — it surfaced unrelated `gov.scot`
documents instead — while the same page was directly findable with a
well-phrased **English** query. Rather than translate with a fixed
dictionary or a query-rewrite regex, this round adds one narrow AI call:

```
Topic (Chinese/bilingual) → Query Planner (Terra) → 3 English search queries → Search Router → ... → Research Model (Sol)
```

`research-query-planner.ts` — pure schema/prompt/conversion, no network,
no "server-only" import:

- `ResearchQueryPlanSchema` — exactly three required, non-empty,
  length-capped string fields: `official_query`, `legal_query`,
  `general_query`. Nothing else — no `analysis`/`reasoning`/`sources`/
  `confidence`/`route`/`rule_number`/etc.
- `RESEARCH_QUERY_PLANNER_SYSTEM_PROMPT` — a deliberately narrow contract:
  English-only output, preserve the real relationship in the question
  (comparison/causal/eligibility/absence/exception/fee-logic/etc.), never
  answer the question or output a legal conclusion, never invent a
  URL or an Immigration Rules paragraph number, and never treat the
  user's own stated premise (e.g. a specific £ figure) as verified fact —
  it's a direction to investigate, not a confirmed claim. No hard-coded
  Chinese→English dictionary — official terminology comes from the
  model's own domain knowledge.
- `planToResearchSearchQueries()` — converts the validated plan into the
  same 3-query `ResearchSearchQuery[]` shape Round 4B already uses:
  `official_query`/`legal_query` restricted to `PRIMARY_SOURCE_DOMAINS`,
  `general_query` unrestricted. Still exactly 3 searches, never 4 or 5.

**Resolved through the Model Router like any other task** — task type
`RESEARCH_QUERY_PLANNING`, employee `researcher`, production default
`OPENAI`/`gpt-5.6-terra` (see `docs/model-router.md`). The planner does
**not** use `buildSkillPrompt("researcher", ...)` — it's infrastructure,
not B｜政策研究员's Skill-governed behavior; B's formal research call
(`RESEARCH`/Sol) still gets the full `GLOBAL_SKILL` +
`RESEARCHER_SKILL` + `EXTERNAL_RESEARCH_SYSTEM_PROMPT` stack, unchanged.

**Fails safe, never blocks Research**: any failure — no model resolves,
the generation call itself errors, or the output fails
`ResearchQueryPlanSchema` validation (handled automatically by
`dispatchStructuredAnyProvider`'s existing Zod check) — falls back to
Round 4B's deterministic `buildResearchSearchQueries(topic)`, logged via
`console.info("[research] query planning fallback used...")`. It is never
a second point of failure for the whole Research task. It's also skipped
entirely (no wasted AI call) when no search provider is even configured
— see `resolveResearchSearchQueries()` in `router.ts`.

**Cost**: exactly one extra AI call on the success path — a normal
Research execution is now 2 AI calls total (Query Planner + Sol), never
3. Topic Discovery (Employee A) is completely unaffected; it never
resolves `RESEARCH_QUERY_PLANNING`.

### Query strategy — official-first Research Search (Round 4B)

`buildResearchSearchQueries()` in `research-queries.ts` derives **up to
3** search queries — the deterministic fallback used when the Query
Planner isn't available or fails — still a template, never an extra LLM
call — but Round 4B changed *how* "search official sources" is expressed.

**What broke the old approach.** Round 4 originally expressed "prefer
official domains" as a text suffix — `"${base} gov.uk"`,
`"${base} Home Office guidance ${audience}"`. A real production run
(Returning Resident case, 2026-09) showed this failing on a
Chinese-language question: Tavily matched the literal string "gov.uk"
and returned `https://www.gov.uk`'s bare homepage, even though the real
page (`gov.uk/returning-resident-visa`) existed and was directly
findable — just not via that diluted text query.

**The fix**: express "official domain" through the Search Provider's own
domain-filtering capability (Tavily's `include_domains`, wired into
`tavily-provider.ts`'s `RunTavilySearchOptions.includeDomains` since
Round 4A but not applied until now) instead of a text keyword. Each
search query is now a `ResearchSearchQuery` (`{ query, includeDomains? }`,
`search/types.ts`) rather than a bare string.

**`include_domains` alone is a soft ranking preference, not a filter —
confirmed live.** Tavily's own API reference documents `include_domains`
as a *boost* by default; it only becomes a hard filter when
`include_domains_mode: "filter"` is also sent (`"boost"` is the
documented default otherwise). A real test with `include_domains:
["gov.uk"]` and no mode set still returned results from unrelated
commercial law-firm domains — confirming this live, not just from the
docs. `runTavilySearch` now always sends `include_domains_mode: "filter"`
alongside `include_domains` whenever any are given.

The three queries:

1. **Official primary search** — the real question/title itself, with no
   suffix at all, restricted to `PRIMARY_SOURCE_DOMAINS` via
   `includeDomains`.
2. **Official legal/guidance search** — the same topic plus a light
   legal-retrieval-intent phrase ("Immigration Rules"), also restricted
   to `PRIMARY_SOURCE_DOMAINS` — catches cases where the bare question
   doesn't match official wording but a legal-intent phrasing does.
3. **General secondary search** — the same question, no domain
   restriction at all — professional commentary, common misconceptions,
   news background. Still real evidence, never allowed to outrank an
   official extract (see the evidence hierarchy above).

Results across all three are pooled, **de-duplicated by URL**
(`dedupeSearchResultsByUrl` — queries 1 and 2 can legitimately return the
same official page) and re-ranked (`rankSearchResults`) — primary domains
first, **and, within the primary group, a specific page ranks ahead of a
bare domain homepage** (`isBareHomepage`: `pathname === "/"` or empty —
generic, not hard-coded to any one topic's URL; a homepage is still kept,
never discarded, for when nothing more specific was found). Secondary
sources are never discarded — they can still help the model triangulate.

`runResearchSearch()` (`search/router.ts`) accepts a plain `string` or a
`ResearchSearchQuery` object per query — Topic Discovery (Employee A,
`buildDiscoveryQueries`) is completely unaffected and still only ever
passes plain strings. Brave has no domain-filtering support in this app;
`includeDomains` on a Brave-routed query is genuinely ignored (not
pretended to be honored) — see `router.test.ts`'s explicit coverage.

This round deliberately did **not** add a translation step, a fixed
Chinese↔English immigration-term dictionary, or a second AI call to plan
queries — the goal was to test whether Tavily's own (correctly
hard-filtered) domain restriction, combined with the real (often
bilingual/Chinese) question text, is already enough.

**Finding (Returning Resident case, re-tested with the corrected hard
filter): official domain filtering alone is insufficient.** With
`include_domains_mode: "filter"` genuinely restricting Search 1/2 to
`PRIMARY_SOURCE_DOMAINS`, the Chinese-language query still did not
surface `gov.uk/returning-resident-visa` — it surfaced unrelated
`gov.scot` documents (refugee integration strategy, Scottish
independence citizenship papers) instead, because Tavily's own semantic
ranking *within* the domain-restricted set didn't favor the actually
relevant page for this query's wording. The same page IS directly
findable with a well-phrased **English** query. This is reported as a
known limitation rather than silently patched with a translation step,
per the explicit decision to stop and report here rather than add a
query-planning agent, translation agent, or query-rewrite LLM this round.

### Official source extraction (Round 4)

Tavily Search alone (like every search API here) only ever returns a
title and a short content snippet, not the page itself. Before Round 4,
that meant the analysis model reasoned entirely from snippets, even for
questions GOV.UK/Immigration Rules/Home Office guidance already answers
directly — a real production case found the model landing on `LOW
confidence, 59/100` for exactly this reason, since it genuinely hadn't
been given anything beyond a snippet to work with.

Round 4 adds one enrichment step between Search and the Model Router:

```
Research Task → Search Router (discover sources) → Official Source Extraction (read a few top primary sources' real content) → Model Router → AI Model → Research Pack
```

**Search discovers. Extraction reads. The model only ever analyses
what was actually retrieved this run** — it is never told, and never
assumes, that "official extraction always happens" or "every source gets
read." Concretely:

1. `research-queries.ts`'s `selectOfficialExtractionTargets()` (Round 4D —
   see "Query-aware official extraction selection" below) picks up to
   `MAX_OFFICIAL_EXTRACTS` (**3**) distinct, deduplicated URLs — reusing
   `isPrimarySourceUrl()` (no second official-domain list) so only
   `gov.uk`/`legislation.gov.uk`/`parliament.uk`/`gov.scot`/
   `immigrationadviceauthority.gov.uk` results are ever candidates.
   Commercial immigration sites, forums, and news outlets are never
   extracted — only ever discovered and passed through as snippets.
2. `src/lib/search/extraction.ts`'s `extractOfficialSources(urls, query)`
   is the *search-layer* seam the AI/business layer goes through instead
   of importing `tavily-provider.ts` directly (mirrors how `router.ts`
   is the only seam for search itself). It defensively re-validates
   https-only + the same cap + dedupe before calling Tavily — no
   localhost/private-network/arbitrary-scheme URL, and never more than 3
   real Search Router results, ever reach the extraction call.
3. That calls **Tavily's Extract endpoint** (`POST
   https://api.tavily.com/extract`, confirmed against Tavily's official
   API reference on 2026-09-15) via `tavily-provider.ts`'s
   `runTavilyExtract()` — a separate operation from `runTavilySearch()`,
   never folded into it. `query` (Tavily's own "user intent for
   reranking extracted content chunks") is built by
   `buildExtractionQuery()` from the real topic's title/question/business
   — never a hard-coded, scenario-specific term list — so the returned
   content is relevance-ranked toward the actual research question, not
   just the top of the page. A per-source character cap
   (`MAX_CHARS_PER_SOURCE` in `extraction.ts`) is a defensive backstop,
   not the primary quality mechanism — `chunks_per_source` is.
4. `research-external.ts`'s `buildSearchResultManifest()` now tags every
   manifest entry with an **Evidence type**: `OFFICIAL_EXTRACT` (real
   content came back for that URL) or `SEARCH_SNIPPET` (it didn't —
   extraction wasn't attempted for it, or it failed). The two are never
   conflated in the manifest text sent to the model.
5. `EXTERNAL_RESEARCH_SYSTEM_PROMPT` tells the model it may reason
   directly from an `OFFICIAL_EXTRACT` entry — but only about what is
   actually shown, never a section/exception/detail that isn't present in
   it, since an "extract" may itself be a relevance-ranked excerpt rather
   than the complete document. `SEARCH_SNIPPET` entries keep the original
   conservative treatment (partial, no inferred exceptions, no invented
   paragraph numbers). An explicit **evidence hierarchy** (legislation >
   Home Office guidance > GOV.UK guidance > other official material >
   professional secondary material > commercial immigration sites >
   social/forums) means an official extract always outweighs a commercial
   site's explanation of the same question — a QC Immigration blog post
   can no longer out-argue what a GOV.UK extract directly shows.
   Confidence is scored against evidence *level*, not a fixed assumption
   about what this system can retrieve: several consistent
   `OFFICIAL_EXTRACT` entries can justify HIGH even with little secondary
   material; snippet-only evidence stays conservative, same as before.
6. `buildExternalGroundedPack()`'s disclosure note in `warnings` now
   reflects real retrieval state instead of a fixed claim: "未读取官方页面
   正文" when nothing was extracted this run, or "已读取 N 个官方来源中与
   本题相关的提取内容；其余来源仍可能仅为搜索摘要" when some were — plus a
   separate note when an extraction attempt genuinely failed for a source
   (extraction failure never fails the whole Research task; that source
   just stays a `SEARCH_SNIPPET`).

**What does NOT change:** `GroundedSource` (the row shape written toward
`research_sources`) still only ever stores `title`/`url`/`note` (the
short snippet)/`pageAge` — real extracted page content is used once, for
this one Sol/Gemini call, and is never persisted anywhere (no
`research_sources` column, no `content_assets`, no activity log). Label
grounding (`S1`/`S2`... citation, hallucinated-label dropping) is
unchanged. Extraction-target selection is a deterministic, rank-based
step plus one Tavily Extract call, never a second model call, reranker,
or embedding step — it costs zero extra AI calls (a normal Research
execution is 2 AI calls total: Query Planner + Sol, see "Research Query
Planner" above).

A safe, general-purpose page fetcher (arbitrary URL, arbitrary domain)
remains explicitly out of scope — extraction only ever runs against URLs
that came from a real Search Router result for *this* run, capped at 3,
deduplicated, https-only.

### Query-aware official extraction selection (Round 4D)

The original selector (`selectOfficialSourcesForExtraction`, Round 4A)
picked the first `MAX_OFFICIAL_EXTRACTS` primary-source URLs from the
pooled, cross-query-deduplicated result list, in pooling order. A real
production case exposed the flaw: `OFFICIAL_PRIMARY` (query 1, always
pooled first) returned 3 weakly-relevant Parliament petition pages, while
`OFFICIAL_LEGAL` (query 2) found the single most relevant page — the
exact target GOV.UK guidance page — but all 3 extraction slots had
already gone to query 1's results purely because of pooling order, not
relevance.

**The fix**: `research-queries.ts`'s `tagSearchHitsByLane()` zips each
raw search result with which of the 3 Research Search lanes
(`OFFICIAL_PRIMARY` / `OFFICIAL_LEGAL` / `GENERAL`) produced it and its
rank within that lane's own results — transient, execution-only metadata
carried on `ResearchSearchQuery.lane` (`search/types.ts`), never
persisted. `selectOfficialExtractionTargets()` then applies a
deterministic "coverage before depth" strategy — no relevance AI, no
embeddings, no new domain-authority scoring beyond what
`isPrimarySourceUrl` already does:

1. The best (specific-page-first, then lowest in-lane rank) valid
   candidate from `OFFICIAL_LEGAL` — a Research pipeline's Home
   Office guidance / Immigration Rules / statutory material is worth the
   first extraction opportunity for *every* topic (Student Visa, Skilled
   Worker, EUSS, Citizenship, ...), not a Returning-Resident-specific
   rule.
2. The best valid candidate from `OFFICIAL_PRIMARY`.
3. Any remaining slots: the next-best remaining candidates from
   `OFFICIAL_LEGAL` + `OFFICIAL_PRIMARY` combined.
4. Only if those two lanes together can't fill every slot: fall back to
   `GENERAL`'s own primary-source results (never its commercial ones —
   `isPrimarySourceUrl` already excludes those; a `GENERAL` lane's
   Free Movement blog post is never an extraction candidate).

Homepage demotion (a specific page always outranks a bare official
homepage) and cross-lane URL dedup (the same page found by both official
queries is only ever extracted once) both still apply, now scoped inside
this lane-aware selection instead of the old flat one.

**What does NOT change**: this only affects which ~3 URLs get a real
page-content fetch. Every real search result across all 3 lanes still
enters the Evidence Manifest as `OFFICIAL_EXTRACT` or `SEARCH_SNIPPET` —
extraction-target selection and evidence coverage are separate concerns;
narrowing the former never narrows the latter.

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

- A persisted `search_routing_config` default (mirrors `model_routing_config`)
  and a UI control for the task-level search-provider override (would let
  ADMIN choose Brave for one run without a code-level override).
- Exa, or any other additional Search Provider.
- Automatic full-page verification, vector search/RAG, a search-result cache.
