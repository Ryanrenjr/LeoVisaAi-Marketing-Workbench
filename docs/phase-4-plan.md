> **HISTORICAL** — describes an earlier phase of this project's build-out
> and may not reflect current behavior. See CLAUDE.md and
> [docs/architecture.md](architecture.md) for the current source of truth.

# Phase 4 — Content Agent

"One Research → Three Outputs." Given an approved Research Pack, generate
platform-specific drafts for 视频号 (VIDEO_CHANNEL), 小红书 (XIAOHONGSHU),
and 公众号 (WECHAT_OFFICIAL_ACCOUNT) — treating that Research Pack as the
authoritative evidence base, never inventing new immigration rules.

**Explicitly out of scope this round**: Compliance review, final Expert
content approval, Lead/CRM/Case Brain, publishing automation, video
editing, analytics, client-facing legal advice. None of it was touched.

## Architecture added

- `src/lib/ai/content-schemas.ts` — pure: Zod schemas (`VideoChannelContentSchema`,
  `XiaohongshuContentSchema`, `WechatOutlineSchema`, `WechatFullArticleSchema`),
  the source-manifest builder (labels sources "S1"/"S2"... so the model
  never sees a real URL to imitate), `groundContentSources` (the
  anti-hallucination filter, same pattern as Research Agent's
  `groundSources`), and the forbidden-phrase safety net. No network, no
  `server-only` — fully unit-tested without mocking.
- `src/lib/ai/content-agent.ts` — server-only orchestration: four exported
  functions (`generateVideoChannelContent`, `generateXiaohongshuContent`,
  `generateWechatOutline`, `generateWechatFullArticle`), each an
  independent Anthropic call using **structured outputs**
  (`client.messages.parse` + `zodOutputFormat`) rather than Research
  Agent's manual-JSON-in-text approach — a better fit here since content
  generation needs no tool use (no web search), so the SDK's own
  schema-constrained output does the heavy lifting; a Zod
  `.safeParse()` re-validation still runs before anything is treated as
  usable, per the explicit "validate before storing" requirement.
- `src/lib/content-mapping.ts` — pure: derives the plain `title`/`content`
  preview columns from a structured object, and merges a human edit back
  into the structured shape without touching sources or evidence notes.
  Lives outside `content-actions.ts` because a `"use server"` file may
  only export async functions — these needed to be both synchronous and
  independently testable.
- `src/lib/content-versions.ts` — pure: lineage grouping and
  next-version-number computation, shared by generation and editing.
- `src/app/topics/content-actions.ts` — the Server Actions: `generateContent`
  (the initial 3-platform batch), `regeneratePlatformContent` (single
  platform — also serves as "retry"), `generateFullArticle` (separate,
  deliberate), `editContentAsset`.
- `src/lib/permissions.ts` — added `canManageContentAssets` (ADMIN-only);
  reused the existing `canGenerateContent(status)` gate built in Phase 3.5
  for exactly this purpose (see "where Content AI fits" below).

**Where Content AI fits**: `RESEARCH_APPROVED` was already the gate;
`CONTENT_DRAFT` already existed in the enum, unused, from Phase 3.5's
"prepare the full status model" work — this milestone is the first thing
that actually writes to it.

**Reused as-is, unmodified**: `requireUser()`, `getTopicById`/
`getLatestResearchPack`/`getResearchSources`, the `topic_activity_log` +
`ai_usage_log` access patterns, the demo-mode fallback convention in
every data-access function, and — most directly — `canGenerateContent()`,
which already encoded "research must be `RESEARCH_APPROVED` or later,"
covering both the very first generation and later regeneration (which
necessarily happens after the topic has already moved to `CONTENT_DRAFT`)
with the same one function.

## Database migration (`0005_content_agent.sql`)

- `content_platform` enum, `content_asset_status` enum.
- `ai_usage_log.platform` (nullable — set for content calls, null for
  research calls).
- `content_assets` table — see `docs/data-model.md` for full columns.
  `research_pack_id` is `on delete restrict`, not cascade: a content
  asset must always be able to point back to its research.
- Six new `topic_activity_type` values.

No new publishing-workflow tables, and no separate source-join table —
`structured_content.source_references` holds validated `research_sources.id`
values directly. A join table would only earn its cost once something
needs to query "which content cites source X" across topics, which
nothing does yet.

## Content schemas

Four Zod schemas (fields exactly as specified) plus a shared
`EvidenceNoteSchema` (`{ claim, reason: "expert_review_required" |
"research_gap", note }`) embedded in every platform schema as
`expert_review_notes`. Malformed output (wrong types, out-of-range
`target_duration_seconds`, wrong `title_options`/`pages` array lengths,
invalid `reason` enum value, missing required fields) is rejected before
anything is saved — see `content-schemas.test.ts` and
`content-agent.test.ts` for the specific rejection cases exercised.

## Anthropic Content Agent behaviour

- **Evidence boundary**: the system prompt (shared preamble +
  per-platform addendum, see `CONTENT_AGENT_SHARED_RULES` in
  `content-schemas.ts`) explicitly instructs the model to distinguish
  Research-Pack-supported claims from editorial framing from claims it
  can't support — the third kind must go into `expert_review_notes`
  (`research_gap` or `expert_review_required`), never be asserted.
  **This is a prompting instruction, not something code can verify** —
  see "Limitations" below.
- **Leo persona / forbidden phrases**: prompted per spec (no fixed
  greeting, no fear-based language) *and* backed by a code-level safety
  net — `scanForbiddenPhrases`/`buildForbiddenPhraseNotes` scans every
  generated text field for the five listed phrases and, if found,
  auto-appends an `expert_review_required` note. Detection doesn't block
  generation; it just makes the phrase impossible to miss during review.
- **Video structure** (0–5s / 5–25s / 25–60s / 60–90s / ending) and
  **Xiaohongshu's independent adaptation** (not a reformatted video
  script) are both prompted instructions — verifying the model actually
  follows them is a manual-review task, not something Zod can check.
- **WeChat**: outline-only by default; the full article requires the
  separate `generateFullArticle` action and an existing outline to expand
  (its structure/claims are passed back to the model as context, so the
  article doesn't drift from what was already reviewed as an outline).

## Source-traceability approach

The model never sees a real URL. Sources are presented as a numbered
manifest ("[S1] title — url — note"); the model may only cite by label in
`source_references`. After generation, every claimed label is resolved
against the manifest actually given — an invented or mistyped label is
silently dropped (never resolved to a fabricated id), and a dropped-count
note is appended to `expert_review_notes` when this happens. Only labels
that resolve are converted to real `research_sources.id` values before
storage. See `groundContentSources` and its test coverage — the same
"code enforces it, not just the prompt" pattern as Research Agent's
`groundSources`.

## Versioning approach

Every generation or edit inserts a new `content_assets` row;
`(topic_id, platform, content_type)` is the lineage key, `version` = prior
max + 1 (or 1 for a new lineage). The UI always shows the highest version
of each lineage, with older versions available (full content, not just a
summary) behind a native `<details>` disclosure — no diff tool, per the
explicit "no complex visual diff tool required" instruction.

## Permissions

`ADMIN`: generate, regenerate, edit (`canManageContentAssets`). `EXPERT`:
view only — no write path exists for `EXPERT` on any content action.
**Neither role can bypass the `RESEARCH_APPROVED` gate**: `canGenerateContent(status)`
is checked inside every content Server Action itself (`loadGenerationContext`
in `content-actions.ts`), not only in which buttons the UI renders — an
attempt against a topic that hasn't had research approved throws a clear,
specific error before any Anthropic call is made or any row written.

## Test coverage

137 tests passing across 13 files (up from 128 in Phase 3.5). New this
round:

- `content-schemas.test.ts` (23 tests) — schema acceptance/rejection for
  all four content types, source-manifest labeling, `groundContentSources`
  (verified-sources-only, dedup, whitespace tolerance), the
  forbidden-phrase scanner, evidence-context building.
- `content-agent.test.ts` (13 tests, Anthropic SDK fully mocked) —
  success path with label→UUID grounding, fabricated-label rejection
  end-to-end, forbidden-phrase flagging without failing generation,
  malformed/out-of-range output rejected before saving, null
  `parsed_output` handling, API error formatting, and the WeChat full
  article correctly including outline context in its prompt.
- `content-versions.test.ts` (8 tests) — version increments per lineage,
  independent version counts per platform *and* between the WeChat
  outline/full-article lineages sharing one platform, latest-version
  lookup regardless of array order.
- `content-mapping.test.ts` (9 tests) — title/content derivation per
  platform, edit-merge preserving untouched fields (sources, evidence
  notes), Xiaohongshu page re-splitting, and — critically — that editing
  a WeChat *outline* touches `summary` while editing a WeChat *full
  article* touches `full_article`, distinguished purely by shape.
- `permissions.test.ts` extended for `canManageContentAssets`.

**Explicitly not re-tested this round** (already covered, same as Phase
3/3.5): `canGenerateContent`'s RESEARCH_APPROVED-or-later gating — that's
the identical function tested last round, now reused rather than
duplicated. **Not directly unit-tested**: the full `content-actions.ts`
Server Actions (Supabase-integrated) — same scope decision as
`research-actions.ts` before it: the pure logic underneath (schemas,
grounding, versioning, mapping) is thoroughly tested; the orchestration
that calls Supabase is verified by architecture (independent
`Promise.allSettled` calls, independent inserts, no shared mutable state
between platforms — so one failing structurally cannot delete or corrupt
another's row) and by manual testing, not by a mocked-Supabase test suite.

Ran `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` —
all pass. (This repo uses npm, not pnpm — no `pnpm-lock.yaml`, pnpm isn't
installed in this sandbox — so the equivalent npm scripts were used, same
as the previous round.)

## Manual test steps

Using an already-`RESEARCH_APPROVED` topic (e.g. 老永居离境超过2年，身份还在吗？,
after completing the Phase 3/3.5 research-approval flow):

1. As ADMIN, on the Topic Detail page you should see a **生成内容** box
   above the tabs (only visible when no content exists yet). Click it.
2. Wait for generation (three independent calls — expect it to take some
   seconds to a minute). Check **视频号** and **小红书** tabs show full
   structured drafts; **公众号** shows an outline (not a full article).
3. Confirm the topic's status badge now reads **内容草稿**
   (`CONTENT_DRAFT`), not `READY_TO_SHOOT`.
4. Check **来源** on each tab resolves to real, clickable research
   sources — not invented URLs.
5. Check **需要Leo确认** sections — if the research pack had gaps, you
   should see `research_gap`/`expert_review_required` notes rather than
   confidently-stated unsupported claims.
6. Click **编辑** on the 视频号 draft, change the text, save — confirm it
   redirects back and the tab now shows **v2**, with **v1** still viewable
   under "历史版本".
7. Click **重新生成** on 小红书 — confirm a new version appears and the
   previous one is still accessible.
8. On **公众号**, click **生成完整文章** — confirm it produces a full
   article consistent with the outline's structure and claims, and that
   its own sources still trace back to verified research sources.
9. As EXPERT, confirm you can view all of the above but there is no
   generate/regenerate/edit control anywhere in the content tabs.
10. To test failure isolation: temporarily break `ANTHROPIC_API_KEY`,
    click 重新生成 on one platform — confirm that platform shows a failure
    banner with retry, while the other two platforms' existing content is
    untouched.

## Limitations and risks to inspect before starting Compliance

- **Evidence-boundary adherence is prompted, not mechanically enforced.**
  Source grounding and forbidden-phrase flagging are code-level
  guarantees; whether the model actually confines itself to claims
  traceable to the Research Pack (vs. stating something plausible-sounding
  that happens not to be a "cited fact") is not something this milestone
  can verify automatically. Read several real generations closely before
  trusting this.
- **`expert_review_notes` quality is unverified.** The schema forces the
  model to produce the field; nothing forces it to be honest or complete
  about what actually needs review. Spot-check against topics you know
  have real gaps in their research.
- **I could not run this live** — no `ANTHROPIC_API_KEY` in this sandbox.
  Everything above is verified by mocked tests and code review, not a
  real generation. This is the same limitation as Phase 3/3.5, carried
  forward.
- **The plain-text `content`/`title` columns are a lossy preview.** For
  Xiaohongshu, editing the plain-text `content` field re-splits it into
  pages by blank lines — a reasonable but imperfect round-trip if someone
  edits in a way that doesn't cleanly separate pages.
- **All three platforms share one research source list** in the UI
  (fetched from the topic's *current* latest research pack), not
  individually from whatever pack each specific content asset actually
  cites. In practice these are almost always the same pack, since nothing
  in this milestone re-approves research after content already exists —
  but it's a simplification worth knowing about.
- **No cost tracking beyond `ai_usage_log`** — token counts and latency
  are recorded, but there's no dashboard or budget/alerting on top of it
  yet, per the explicit "do not add a separate cost system yet"
  instruction.
