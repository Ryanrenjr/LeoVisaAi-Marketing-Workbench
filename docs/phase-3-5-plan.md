> **HISTORICAL** — describes an earlier phase of this project's build-out
> and may not reflect current behavior. See CLAUDE.md and
> [docs/architecture.md](architecture.md) for the current source of truth.

# Phase 3.5 — Research Agent acceptance & hardening

This round doesn't add a new milestone's worth of features. It closes
gaps found in the Phase 3 Research Agent implementation before Content AI
starts building on top of it — see `docs/phase-3-plan.md` for the original
design.

## Weaknesses found in the previous implementation

1. **No status distinction between "AI just produced a pack" and "an
   Expert reviewed it."** A successful `运行研究` left the topic at
   `RESEARCHING` — the same status as "nobody has run anything yet." There
   was no way to tell, from status alone, whether a pack existed and was
   waiting for review.
2. **"请求修改" (request changes) didn't actually change anything visible.**
   It logged an activity entry, but the topic's status stayed put, so
   there was no real signal telling the ADMIN "this needs rework" versus
   "this is fine, just hasn't been looked at yet."
3. **The final Phase 1 status model wasn't in the schema at all** —
   `CONTENT_DRAFT` / `COMPLIANCE_REVIEW` / `LEO_REVIEW` / `APPROVED` didn't
   exist, so there was no way to reason about (or test) the shape of the
   pipeline Content AI will eventually plug into.
4. **No confidence signal.** The Research Pack presented every result with
   the same visual weight whether the model found three consistent
   official sources or one thin, ambiguous one. There was no mechanism
   forcing a distinction, and nothing stopped a "not sure" answer from
   looking exactly as authoritative as a well-supported one.
5. **Source freshness was discarded.** Anthropic's `web_search` tool
   returns `page_age` on every real result; the code read `title`/`url`
   and threw the rest away, so a reviewer had no way to tell a source from
   last week apart from one from three years ago.
6. **The orchestration layer (`research-agent.ts`) had zero test
   coverage.** Only the pure parsing/grounding functions in
   `research-pack.ts` were tested — the actual Anthropic SDK call
   (streaming, `pause_turn` resume, error formatting, latency
   measurement) was unverified by anything except manual review.
7. **Two RLS/authorization guarantees existed only in role checks, not in
   status checks.** `approveResearch` and `requestResearchChanges` gated
   on role (EXPERT) but not on the topic actually being in a reviewable
   state — nothing stopped (in theory) approving a topic that was still
   `RESEARCHING` with no pack, since the only guard was
   `topic.status !== "RESEARCHING"`, which a `RESEARCHING` topic trivially
   passes even with no pack at all.

## Improvements made

- **`RESEARCH_READY`** is now a real, distinct status: `RESEARCHING` →
  (successful run) → `RESEARCH_READY` → (Expert decision) →
  `RESEARCH_APPROVED` or back to `RESEARCHING` (changes requested). See
  `src/lib/research-workflow.ts` for the three pure gating functions this
  is built from (`canRunResearchFromStatus`, `canApproveResearchFromStatus`,
  `canRequestResearchChangesFromStatus`), each independently unit-tested.
- **Confidence** (`LOW`/`MEDIUM`/`HIGH`) is now part of the Research Pack
  schema. The model self-assesses it (system prompt instructs it to be
  honest and default low when unsure); if it's missing or unreadable, the
  code defaults it to `LOW` and says so in the warnings — never silently
  upgraded. `LOW` confidence renders as a distinct red-bordered banner on
  the Topic Detail page, separate from and in addition to the always-on
  Expert warning banner.
- **`page_age` is now captured and shown** next to each source.
- **The full Phase 1 status model is in the schema** (`RESEARCH_READY`,
  `CONTENT_DRAFT`, `COMPLIANCE_REVIEW`, `LEO_REVIEW`, `APPROVED` all
  added), and `src/lib/topic-workflow.ts`'s `nextStatus()`/
  `isAllowedTransition()` reflect the complete intended order — without
  wiring any action into the not-yet-built stages.
- **`research-agent.ts` now has real test coverage** with the Anthropic
  SDK fully mocked (`src/lib/ai/research-agent.test.ts`) — success,
  fabricated-citation rejection end-to-end, invalid JSON, missing text
  block, `pause_turn` resume, giving up after too many pauses, API error
  formatting, and latency measured from actual elapsed time. No test in
  this repo makes a live Anthropic API call.
- **Approval and changes-requested are now gated on status, not just
  role**: both require `RESEARCH_READY` specifically (via
  `canApproveResearchFromStatus`/`canRequestResearchChangesFromStatus`),
  so there is no path to approving a topic that hasn't actually produced a
  reviewable pack.
- **`/research-completed` no longer offers a generic "advance" button.**
  With `CONTENT_DRAFT` now the mathematically-next stage after
  `RESEARCH_APPROVED`, the old button would have silently pushed topics
  into a status with no page to view or manage them. It now shows a plain
  "等待内容生成（Content AI 尚未上线）" notice instead — the one UI change
  this round required outside the Topic Detail page itself.

## Schema changes (migration `0004_research_workflow_hardening.sql`)

- `topic_status` gains five values: `RESEARCH_READY` (after `RESEARCHING`),
  `CONTENT_DRAFT`, `COMPLIANCE_REVIEW`, `LEO_REVIEW`, `APPROVED` (after
  `RESEARCH_APPROVED`, in that order). No renames this round.
- New enum `research_confidence`: `LOW` \| `MEDIUM` \| `HIGH`.
- `research_packs.confidence` — `research_confidence`, not null, default
  `LOW`.
- `research_sources.page_age` — text, nullable.

See `docs/data-model.md` for full column-level detail.

## Status model changes

See "Status pipeline" in `docs/data-model.md` for the diagram. Summary:
`RESEARCH_READY` is new and sits between `RESEARCHING` and
`RESEARCH_APPROVED`; approval and changes-requested now both operate on
`RESEARCH_READY` (previously both operated on `RESEARCHING`, which is why
weakness #7 above was possible). `RESEARCH_APPROVED` remains the one and
only landing spot for research approval — it still cannot become
`READY_TO_SHOOT` automatically, which was true before this round and
remains true now (re-verified, since it was explicitly called out as a
requirement this round too).

## Test coverage added

- `src/lib/ai/research-pack.test.ts` — extended: confidence
  parsing/defaulting/case-normalization (LOW-confidence handling),
  `page_age` passthrough, an http-vs-https non-match case, three new
  schema-validation rejection cases (non-string `key_findings` element,
  `key_findings` as a string instead of an array, missing `sources`
  entirely).
- `src/lib/ai/research-agent.test.ts` — **new**, Anthropic SDK fully
  mocked via `vi.mock`: not-configured short-circuit, successful grounded
  result, fabricated-citation rejection at the orchestration level (not
  just the pure-function level), invalid JSON failure, missing-text-block
  failure, `pause_turn` resume then success, giving up after too many
  pauses, `Anthropic.APIError` formatting, and latency computed from real
  elapsed wall-clock time (not a stub).
- `src/lib/research-workflow.test.ts` — **new**: all three status gates,
  checked against every status in the enum (not just the happy path).
- `src/lib/topic-workflow.test.ts` — extended for the 9-stage linear
  chain, plus new tests for `isAtOrPastStage`.
- `src/lib/permissions.test.ts` — extended `canGenerateContent` coverage
  across every stage from `RESEARCH_APPROVED` onward, plus `RESEARCH_READY`
  as a "not yet" case; existing `canApproveResearch("ADMIN") === false`
  test already covered "ADMIN cannot approve its own Research Pack" at the
  permission-function level — kept, not duplicated.

Total: 82 tests passing (up from 47), across 9 test files. `npm run lint`,
`npm run typecheck`, `npm run test`, and `npm run build` all pass. (This
repo uses npm — `package-lock.json`, no `pnpm-lock.yaml` — pnpm isn't
installed in this environment, so the equivalent npm scripts were used.)

## What's still unverified without a live Anthropic key

Same limitation as Phase 3: this sandbox has no `ANTHROPIC_API_KEY`, so
none of the above proves the *quality* of real research output — only
that the code around it behaves correctly under controlled, mocked
conditions. See "Manual steps" below.
