# Provider smoke test — status and results

This document records the "make the Model Router / Search Router
actually work end to end" verification passes and their real results.
See `docs/model-router.md` and `docs/search-router.md` for the
architecture this verifies.

## A. Database migrations

**0006 (Model Router) — applied and verified** on 2026-08-20. Initially
found missing via a safe read-only query (service-role key already in
`.env.local`, no DB password needed/used); applied by the ADMIN via the
Supabase SQL Editor (the safest path — uses their own logged-in session,
not a stored database password). Re-verified afterward: both
`model_routing_config` and the four new `ai_usage_log` columns exist.

**0007 (Search Router, `search_usage_log`) — not yet applied.** Same safe
path: paste `supabase/migrations/0007_search_router.sql` into the
Supabase SQL Editor and run it, then re-verify with:

```sql
select to_regclass('public.search_usage_log');
```

Until applied, `writeSearchUsageLog()` fails gracefully (logged
server-side, doesn't block the Research result) exactly like
`writeUsageLog()` did before 0006 was applied.

## B. Provider connection status (as of 2026-08-20)

| Provider | Configured | Notes |
|---|---|---|
| ANTHROPIC | No | not required this milestone |
| GOOGLE | **Yes** | `GOOGLE_AI_API_KEY` set, health check SUCCESS |
| GROQ | **Yes** | `GROQ_API_KEY` set, health check SUCCESS |
| OPENROUTER | No | not required this milestone |

## Model Registry audit (found and fixed — two separate stale-ID issues)

**Groq**: the two models registered in the original Model Router
milestone — `llama-3.3-70b-versatile` and `qwen/qwen3-32b` — were
deprecated by Groq on 2026-06-17, shutdown 2026-08-16 (already past).
**Fixed**: replaced with `openai/gpt-oss-120b` and `openai/gpt-oss-20b`,
confirmed current via `console.groq.com/docs/models`, and confirmed
**working with a real call** during this smoke test (health check
SUCCESS, 793ms, 163/175 tokens).

**Google**: `gemini-2.5-flash` / `gemini-2.5-flash-lite` still appear in
the `models.list` API response but a **real generateContent call failed
live** with `404 "This model models/gemini-2.5-flash is no longer
available to new users"` — Google's own error named the replacement.
**Fixed**: replaced with `gemini-3.6-flash` / `gemini-3.5-flash-lite`,
confirmed via the live `models.list` endpoint for this key and confirmed
**working with a real call** (health check SUCCESS, 2115ms, 43/5 tokens).
This is exactly the class of issue this milestone's "do not assume a
stale model ID is valid just because it exists in code" instruction
anticipated — found via a real call, not assumed.

## Router smoke tests (A–D)

Verified via the automated test suite, exercising the **real production
code** (`model-selection.ts` → `selectModel()`, `router.ts` →
`runResearchTask`/`runContentTask`) with only the provider SDK boundary
mocked. All four passed, and A/D were additionally observed live during
the real Research attempt below (Router correctly picked
`GOOGLE/gemini-3.6-flash` for RESEARCH without any override).

| Test | Scenario | Result |
|---|---|---|
| A | Default free routing | Router selects an eligible FREE, `developmentRecommended` model — confirmed live (`gemini-3.6-flash` for RESEARCH, `gemini-3.6-flash` for VIDEO_WRITING) |
| B | No silent paid fallback | Fails with exactly `"免费模型当前不可用，请选择其他模型。"` |
| C | Temporary override | Dispatches to the overridden model for that one call only; `model_routing_config` is never touched by the override path |
| D | Capability enforcement | RESEARCH rejects a non-web-search model before any provider is contacted, with exactly `"此模型不支持当前研究流程所需的联网能力。"` |

## C. Real Google Research smoke test — **ran twice, both real quota failures**

Topic: T-0001 `老永居离境超过2年，身份还在吗？` (exactly the specified public-policy
topic). Advanced IDEA → RESEARCHING via "开始研究" (real click), then "运行研究":

1. **Attempt 1** — resolved default `GOOGLE/gemini-3.6-flash`. Real API
   call returned `429 RESOURCE_EXHAUSTED: You exceeded your current
   quota` for Google Search grounding specifically (a plain, ungrounded
   call to the same model succeeded fine during the health check minutes
   earlier — the grounding quota is separate and much tighter on this
   brand-new free-tier key/project).
2. **Attempt 2** (one bounded retry, per "genuine failure" allowance) —
   switched to `GOOGLE/gemini-3.5-flash-lite` via "更换本次模型". Same
   `429 RESOURCE_EXHAUSTED` — confirms the quota is per-project, not
   per-model.

**The app behaved correctly throughout**: both attempts wrote a complete,
correctly-populated `ai_usage_log` row (`provider=GOOGLE`,
`task_type=RESEARCH`, `digital_employee=researcher`,
`pricing_type_at_execution=FREE`, `success=false`, real error text,
`latency_ms` ~100ms — confirming the request actually reached Google and
failed fast, not a client-side bug); `research_runs` recorded
`status=failed` with the real error; the topic correctly **stayed at
RESEARCHING** — it was never incorrectly advanced to `RESEARCH_READY`.
No sources, no confidence, no research pack — nothing was fabricated to
paper over the failure. **Did not attempt a third retry** — quota
exhaustion doesn't clear by retrying, and further attempts would only
burn more of the daily quota once it resets, per the "don't consume
quota unnecessarily" instruction.

**This is a real limitation, reported as one, not "fixed" by disabling
grounding or hard-coding a result.** T-0001 is left at `RESEARCHING`,
un-approved, with the two failed attempts visible in its 记录 tab —
accurately reflecting what actually happened.

**Recommended next step**: retry the Research test after Google's daily
quota resets (typically UTC midnight), or configure `ANTHROPIC_API_KEY`
to unblock research via Anthropic in the meantime — Anthropic's paid tier
doesn't share this free-tier-specific grounding quota constraint (a
paid-model warning would show first, per existing UX).

## D. Content provider-switching smoke test — **blocked on real data, not code**

Checked every topic at `RESEARCH_APPROVED` or later (T-0007, T-0008,
T-0009, T-0010, T-0011): **all have zero rows in `research_packs` and
`content_assets`** despite their pipeline status — these were seeded
directly at an advanced `topics.status` for the pipeline **stage views**
(`/research-completed`, `/ready-to-shoot`, `/published`), which only read
`topics.status`, not for the AI generation flow, which needs a real
`research_packs` row to ground content in.

Attempting content generation against T-0007 correctly failed with
`"未找到已批准的研究成果，无法生成内容。"` — **this is the app's evidence-boundary
gate working exactly as designed** (`content-actions.ts` refuses to
generate content without a real, traceable research pack behind it,
regardless of what `topics.status` claims). Per this milestone's explicit
instruction ("if none exists, do not bypass Expert approval — explain
what human action is needed"), **no research pack was fabricated** to
force this test through.

**Human action needed before this test can run**: a topic needs to reach
`RESEARCH_APPROVED` through the real workflow — i.e., a successful
Research Agent run (blocked on the Google quota above, or unblockable
today via Anthropic) followed by a real Expert clicking 批准研究. Once
either exists, re-run: generate 视频号 with the resolved default, then
"更换本次模型" → the other free provider, and confirm both versions share
one lineage, the same `research_pack_id`, and distinct `ai_usage_log`
rows.

## E. Provider health check — **ran for real, both SUCCESS**

`/admin/ai-models`, ADMIN-only. Both buttons clicked for real:

| Provider | Model tested | Status | Latency | Tokens (in/out) |
|---|---|---|---|---|
| GOOGLE | `gemini-3.6-flash` | SUCCESS | 2115ms | 43/5 |
| GROQ | `openai/gpt-oss-120b` | SUCCESS | 793ms | 163/175 |

No key was ever exposed in the UI response (also covered by
`provider-health.test.ts`).

## AI usage log reliability (implemented this milestone, confirmed live)

`ai_usage_log` inserts are no longer fire-and-forget —
`src/lib/ai/usage-log.ts` → `writeUsageLog()` checks the insert's error,
logs it server-side, and would surface a restrained ADMIN-only
"AI 使用记录写入失败" notice on the Topic Detail page's 记录 tab without ever
discarding a successful Research/Content result. **Confirmed populated
correctly with real data** during the Research test above — every new
column (`provider`, `task_type`, `digital_employee`,
`pricing_type_at_execution`) was present and correct on both real
(failed) attempts.

## Brave Search: no free tier (real, live finding)

While setting this up, discovered Brave Search API removed its free tier
in 2026-02 — confirmed directly via the Brave developer dashboard
("No subscriptions found... subscribe to a plan before generating API
keys"). It's pay-as-you-go only now (~$5 prepaid, $0.003–0.005/query, no
free plan). **Fixed the registry to reflect this** (`pricingType: "PAID"`
for BRAVE) and **fixed a real bug this exposed**: the Router's
fallback-to-native condition originally only checked for
`SEARCH_PROVIDER_NOT_CONFIGURED`, not "Development Mode found no FREE
provider at all" (`SEARCH_ROUTER_UNRESOLVED`) — with Brave now PAID, the
free-first search legitimately finds nothing, and without this fix
Research would have hard-failed with "免费搜索服务当前不可用" instead of
gracefully continuing to use the still-free native Google/Anthropic
grounding it always could. Both paths are now covered — see
`docs/search-router.md` "How the native path stays supported".

## Search Router smoke test — **pending, needs a decision**

With Brave now paid, Development Mode's default flow no longer
auto-selects it — Research keeps using native grounding (Google/Anthropic)
exactly as it did before this milestone, blocked by the same Google
grounding quota documented above. To actually exercise the Brave → Gemini
path for real requires either:

1. Subscribing to Brave's paid plan (cheap — a few dollars covers many
   test runs) and configuring `BRAVE_SEARCH_API_KEY`, then explicitly
   overriding to it for one Research run (no UI control for this yet —
   see `docs/search-router.md`), or
2. Treating the architectural separation itself as the deliverable this
   milestone (built, unit-tested, ready for Brave whenever it's wanted)
   and unblocking the *first real Research run* some other way — e.g.
   configuring `ANTHROPIC_API_KEY` so native grounding has a working path
   that doesn't share Google's tight free-tier grounding quota.

This is a real decision for the project, not something to route around
silently — see the chat response.

## Seed-data integrity finding (Search Router milestone)

The five topics identified as blocking the Content-switching test above
(T-0007 through T-0011) are traced to `supabase/seed.sql` lines 82-87 —
"Existing Phase 1/2 pipeline demo rows," seeded directly at an advanced
`topics.status` (RESEARCH_APPROVED/READY_TO_SHOOT/PUBLISHED) purely to
populate the pipeline stage-view pages, predating the Research/Content
Agent milestones entirely. Not a bug from this or the prior milestone —
a known, deliberate Phase 1/2 design choice that's now visibly stale
since the database is live. Confirmed via exact title match, `created_by
IS NULL` on all five, and zero rows in `research_packs`/`content_assets`
for any of them.

An admin-visible integrity check (`/admin`, "数据完整性提醒") now surfaces this
class of issue going forward — `src/lib/data-integrity.ts` flags any
topic whose status implies a research pack or content asset that doesn't
actually exist. **Cleanup applied 2026-08-20** (with confirmation, since
it changes what's visible on `/ready-to-shoot`/`/published`): all five
(T-0007–T-0011) reset to `IDEA` via a one-time script matched on exact
seed title + `created_by IS NULL` — no real user-created data was
touched. They can now go through the real Research/Content workflow like
any other topic.

## Known housekeeping item

A temporary ADMIN test account
(`scratch-smoketest-admin@example.com`) was created to drive these smoke
tests through the real, authenticated app (Playwright, real browser — not
a curl/Server-Action workaround, which Next's CSRF protections don't
allow anyway). It could not be cleanly deleted afterward because it's now
referenced by the real `research_runs`/`ai_usage_log` rows created during
this test (deleting it would require cascading those away, discarding the
audit trail). It remains in `profiles` with role `ADMIN` — remove it
yourself via `/admin` (change its role, or delete it and accept the
cascade) whenever convenient; it poses no security risk (test-only
password, not a real identity) but is worth cleaning up.

## F–O. Final report

See the chat response for the structured A–O final report — this
document is the persistent, detailed reference.
