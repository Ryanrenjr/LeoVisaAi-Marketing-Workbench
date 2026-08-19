# Data model

Schema lives in
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql),
[`0002_topic_library.sql`](../supabase/migrations/0002_topic_library.sql),
[`0003_research_agent.sql`](../supabase/migrations/0003_research_agent.sql),
[`0004_research_workflow_hardening.sql`](../supabase/migrations/0004_research_workflow_hardening.sql), and
[`0005_content_agent.sql`](../supabase/migrations/0005_content_agent.sql).
Demo rows live in [`supabase/seed.sql`](../supabase/seed.sql).

## Tables

### `profiles`

One row per internal staff member, keyed to `auth.users`.

| column       | type        | notes                                   |
|--------------|-------------|------------------------------------------|
| `id`         | uuid, PK    | = `auth.users.id`                        |
| `email`      | text        |                                           |
| `display_name` | text     | defaults to the local part of the email  |
| `role`       | `user_role` enum: `ADMIN` \| `EXPERT` | defaults to `EXPERT` |
| `created_at` | timestamptz |                                           |

A row is created automatically (via an `on_auth_user_created` trigger) the
moment a Supabase Auth user is created, defaulted to `EXPERT`. Promoting the
first `ADMIN` is a manual one-time SQL step — see
[phase-1-plan.md](phase-1-plan.md).

### `topics` — the Topic Library (选题库)

The unit of content moving through the pipeline. Extended in migration
`0002` from the Phase 1 placeholder into the real topic model.

| column       | type        | notes                                    |
|--------------|-------------|--------------------------------------------|
| `id`         | uuid, PK    |                                             |
| `code`       | text, unique | auto-generated `T-0001` style via `topic_code_seq` |
| `title`      | text        |                                             |
| `question`   | text        | the specific audience question this topic answers |
| `business`   | text        | practice area / business line (free text, e.g. "永居 / ILR") |
| `audience`   | text        | target audience (free text)                |
| `content_pillar` | `content_pillar` enum, nullable: `policy_update` \| `myth_busting` \| `how_to` \| `case_study` \| `news` | placeholder taxonomy, not fixed by any external spec |
| `priority`   | `topic_priority` enum: `LOW` \| `MEDIUM` \| `HIGH` | defaults to `MEDIUM` |
| `topic_score` | integer, 0–100 | see "Topic scoring" below |
| `score_breakdown` | jsonb: `{ priority, completeness }` | components behind `topic_score` |
| `status`     | `topic_status` enum: `IDEA` \| `RESEARCHING` \| `RESEARCH_READY` \| `RESEARCH_APPROVED` \| `CONTENT_DRAFT` \| `COMPLIANCE_REVIEW` \| `LEO_REVIEW` \| `APPROVED` \| `READY_TO_SHOOT` \| `PUBLISHED` \| `ARCHIVED` | see "Status pipeline" below |
| `created_by` | uuid, FK → `profiles.id`, nullable | nullable so a profile can be removed without deleting history |
| `published_at` | timestamptz, nullable | set when status becomes `PUBLISHED` |
| `created_at` / `updated_at` | timestamptz | `updated_at` maintained by trigger |

The Phase 1 `brief` column was dropped in favor of `question`, which serves
the same purpose more specifically.

### Status pipeline

```
IDEA → RESEARCHING ⇄ RESEARCH_READY → RESEARCH_APPROVED → CONTENT_DRAFT
  → COMPLIANCE_REVIEW → LEO_REVIEW → APPROVED → READY_TO_SHOOT → PUBLISHED
                                                                       ↘
        (any non-archived status) ─────────────────────────────────→ ARCHIVED
```

This is the full intended Phase 1 shape (migration `0004`), but only part
of it is wired to real actions:

- `IDEA → RESEARCHING` ("开始研究") — unchanged since Phase 2.
- `RESEARCHING → RESEARCH_READY` — a research run completes successfully
  (`运行研究`). ADMIN-only.
- `RESEARCH_READY → RESEARCH_APPROVED` — Expert approval (`批准研究`).
  **This is the one and only way to reach `RESEARCH_APPROVED`** — it never
  happens automatically, and it never skips ahead to `READY_TO_SHOOT`.
- `RESEARCH_READY → RESEARCHING` — Expert requests changes (`请求修改`);
  sends the topic back for rework.
- `* → ARCHIVED` ("归档") from any non-archived status.
- `RESEARCH_APPROVED → CONTENT_DRAFT` — the first successful content
  generation for a topic (see "`content_assets`" below and
  `docs/phase-4-plan.md`). Never automatic before that.
- `RESEARCH_APPROVED → READY_TO_SHOOT → PUBLISHED` still reuse the Phase
  1/2 advance-button mechanism on `/research-completed` and
  `/ready-to-shoot` — `/research-completed` still doesn't expose a generic
  "advance" button (the next real stage, `CONTENT_DRAFT`, is reached via
  content generation, not a manual click), it shows a static "等待内容生成"
  notice until you've generated content for that topic.

`COMPLIANCE_REVIEW` / `LEO_REVIEW` / `APPROVED` (合规审核 / Leo审核 / 已批准)
are in the enum and in the linear pipeline order (so `nextStatus()` is
correct end-to-end), but **nothing transitions into them yet** — that's a
future milestone (Compliance, then Leo's final review). See
`src/lib/topic-workflow.ts` for the linear transition rules,
`src/lib/research-workflow.ts` for the research-stage status gates (pure,
unit-tested, used by `src/app/topics/research-actions.ts`), and
`docs/phase-3-5-plan.md` for why `RESEARCH_READY` exists as a separate
status from `RESEARCHING`.

### Topic scoring

`topic_score` (0–100) is a **deterministic, rule-based** calculation — not
AI. See `src/lib/scoring.ts`:

- `priority`: `HIGH` = 60, `MEDIUM` = 35, `LOW` = 15
- `completeness`: +10 each for `business`, `audience`, `content_pillar`,
  `question` being filled in (max 40)

"重新评分" recomputes both from the topic's current fields. The score can
also be manually overridden via the edit form, which is logged separately
(`score_manually_changed`) from a recompute (`topic_scored`).

### `topic_status_events`

Append-only audit trail of **status transitions only**. **This table is
the mandatory human-approval-gate record** — the UI never flips
`topics.status` without also writing one of these rows in the same action,
and every row records exactly one human decision.

| column        | type        | notes                                  |
|---------------|-------------|------------------------------------------|
| `id`          | uuid, PK    |                                           |
| `topic_id`    | uuid, FK → `topics.id`                 |                     |
| `from_status` | `topic_status`, nullable | null for the initial creation |
| `to_status`   | `topic_status`, not null |                                       |
| `approved_by` | uuid, FK → `profiles.id`, not null | must equal the caller's own id (enforced by RLS) |
| `note`        | text, nullable |                                        |
| `created_at`  | timestamptz |                                           |

### `topic_activity_log`

Append-only activity feed shown on the Topic Detail page. Broader than
`topic_status_events` — it also covers non-status activity (editing,
scoring). Both tables coexist and are written independently; a status
transition triggered from the Topic Detail page (start research, archive)
writes to **both**.

| column          | type        | notes                                                          |
|-----------------|-------------|------------------------------------------------------------------|
| `id`            | uuid, PK    |                                                                    |
| `topic_id`      | uuid, FK → `topics.id`                                              |
| `activity_type` | `topic_activity_type` enum: `topic_created` \| `topic_edited` \| `topic_scored` \| `score_manually_changed` \| `research_requested` \| `topic_archived` \| `research_run_started` \| `research_run_completed` \| `research_run_failed` \| `research_edited` \| `research_approved` \| `research_changes_requested` \| `content_generation_started` \| `content_generated` \| `content_generation_failed` \| `content_regenerated` \| `content_edited` \| `full_article_generated` | |
| `actor_id`      | uuid, FK → `profiles.id`, not null | must equal the caller's own id (enforced by RLS) |
| `detail`        | jsonb, nullable | free-form context, e.g. `{ from, to }` for a manual score change, `{ error }` for a failed run |
| `created_at`    | timestamptz |                                                                    |

### `research_runs`

One row per "运行研究" invocation. ADMIN-only (insert/update, enforced by
both RLS and `canRunResearch()`). `requested_by` is nullable for the same
reason `topics.created_by` is — so a profile can be removed without
deleting run history, and so `supabase/seed.sql` can seed a demo run.

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `topic_id` | uuid, FK → `topics.id` | |
| `status` | `research_run_status` enum: `running` \| `completed` \| `failed` | |
| `model_alias` | text | e.g. `claude-opus-5` — from `RESEARCH_MODEL` env, see `docs/architecture.md` |
| `requested_by` | uuid, FK → `profiles.id`, nullable | |
| `started_at` / `completed_at` | timestamptz | `completed_at` null while `running` |
| `error` | text, nullable | set when `status = failed` |
| `created_at` | timestamptz | |

### `research_packs` / `research_sources`

The saved output of a completed run — this is what's shown as the
"Research Pack" on the Topic Detail page. A topic can have multiple packs
over time (re-runs); the UI shows the latest.

`research_packs`: `id`, `research_run_id` (FK, unique — 1:1 with the run),
`topic_id`, `summary` (text), `key_findings` (jsonb array of strings),
`warnings` (text — model-reported caveats, distinct from the always-shown
UI disclaimer), `confidence` (`research_confidence` enum: `LOW` \| `MEDIUM`
\| `HIGH`, not null, **defaults to `LOW`** — a missing or unreadable
confidence claim from the model is never silently treated as trustworthy;
see `src/lib/ai/research-pack.ts` → `normalizeConfidence`), `edited_by`/
`edited_at` (nullable, set when an ADMIN edits the narrative fields),
`created_at`.

`research_sources`: `id`, `research_pack_id` (FK), `title`, `url`, `note`
(one-sentence relevance note), `page_age` (text, nullable — freshness as
reported by the `web_search` tool on the real result, e.g. "3 months ago";
never claimed by the model itself, only carried over from the tool's
actual output), `created_at`. **Every row here is guaranteed to correspond
to a URL Anthropic's `web_search` tool actually returned** — see
`src/lib/ai/research-pack.ts` → `groundSources()`, and its test coverage
for exactly this. There is no UI path to manually add a source; editing a
pack (`editResearchPack`) only touches `summary`/`key_findings`/`warnings`,
specifically so a human can't reintroduce an unverified URL by hand.

### `research_approvals`

The mandatory human-approval-gate record for the research stage.
**EXPERT-only** — RLS enforces `decided_by = auth.uid()` *and* that the
caller's `profiles.role = 'EXPERT'`, so an `ADMIN` cannot insert an
approval row even via a bug in application code.

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `topic_id` / `research_pack_id` | uuid, FK | |
| `decision` | `research_approval_decision` enum: `approved` \| `changes_requested` | |
| `decided_by` | uuid, FK → `profiles.id`, not null | must be EXPERT (RLS) |
| `note` | text, nullable | reason, mainly used for `changes_requested` |
| `created_at` | timestamptz | |

### `ai_usage_log`

One row per model call, for **every** workflow that ever calls a model —
research and content alike. Written on both success and failure.

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `workflow_type` | text | `"research"` or `"content"` |
| `model_alias` | text | |
| `topic_id` | uuid, FK → `topics.id`, nullable | |
| `platform` | `content_platform` enum, nullable | set for `"content"` rows, null for `"research"` rows |
| `input_tokens` / `output_tokens` | integer, nullable | null if the call failed before a response was returned |
| `latency_ms` | integer, not null | |
| `success` | boolean, not null | |
| `error` | text, nullable | |
| `created_at` | timestamptz | |

### `content_assets`

One row per generated (or edited) draft, per platform, per version —
**never overwritten**. Regenerating or editing always inserts a new row
with `version` = previous max + 1 for the same `(topic_id, platform,
content_type)` lineage; the UI shows the latest and keeps older versions
accessible behind a `<details>` disclosure. See `docs/phase-4-plan.md`
"Versioning".

| column | type | notes |
|---|---|---|
| `id` | uuid, PK | |
| `topic_id` | uuid, FK → `topics.id` | |
| `research_pack_id` | uuid, FK → `research_packs.id`, **`on delete restrict`** | always retained for traceability — a content asset must always be able to point back to the exact research it came from |
| `platform` | `content_platform` enum: `VIDEO_CHANNEL` \| `XIAOHONGSHU` \| `WECHAT_OFFICIAL_ACCOUNT` | |
| `content_type` | text, checked against `video_script` \| `xiaohongshu_post` \| `wechat_outline` \| `wechat_full_article` | one platform (`WECHAT_OFFICIAL_ACCOUNT`) has two independent lineages — the outline and, only once separately triggered, the full article |
| `title` | text | plain-text preview, derived from the structured content |
| `content` | text | plain-text preview (e.g. `full_script` for video), derived the same way |
| `structured_content` | jsonb | the authoritative full structured object matching the platform's Zod schema — see `src/lib/ai/content-schemas.ts` |
| `version` | integer, not null, default 1 | |
| `status` | `content_asset_status` enum: `DRAFT` \| `APPROVED` \| `ARCHIVED`, default `DRAFT` | only `DRAFT` is used this milestone — `APPROVED`/`ARCHIVED` are reserved for the later Expert Content Approval milestone, not implemented yet |
| `created_by` | uuid, FK → `profiles.id`, nullable | whoever generated or edited *this version* — since versions are immutable, this alone captures "who created it," no separate `edited_by` column needed |
| `created_at` / `updated_at` | timestamptz | |

`structured_content.source_references` holds real `research_sources.id`
values only — see `docs/phase-4-plan.md` "Source traceability" for how
the model never sees or invents a URL directly.

## Row Level Security

RLS is enabled on every table. Summary (full policies in the migrations):

- Any signed-in staff member (`authenticated`) can **read** every table —
  this is a small internal team and everyone needs visibility into the
  whole pipeline, including AI usage and research history.
- Any signed-in staff member can **create** and **update** `topics`.
- `topic_status_events`, `topic_activity_log`, and `research_approvals`
  rows can only be inserted with the self-attribution column
  (`approved_by` / `actor_id` / `decided_by`) = `auth.uid()` — nobody can
  record an action on another person's behalf.
- `research_approvals` additionally requires the caller's `profiles.role`
  to be `EXPERT` — this is the one place a role check is enforced by RLS
  itself, not just application code, because it's the two-person control
  the whole research-approval step exists for.
- `research_runs`, `research_packs`, `research_sources`, and
  `content_assets` can only be inserted by `ADMIN` (RLS
  `exists (... role = 'ADMIN')` check) — `research_runs`/`research_packs`/
  `research_sources` can also be updated by `ADMIN`; `content_assets` rows
  are never updated (see "Versioning" above), only inserted.
- Only `ADMIN` can update another user's `profiles.role`; a user can update
  their own `display_name`.
- Only `ADMIN` can archive a topic — enforced in application code
  (`src/lib/permissions.ts`), not RLS; RLS allows any staff member to
  update `topics` (needed for edits/rescoring), so the archive-is-ADMIN
  rule is a product decision layered on top, not a database constraint.
- The service-role key (used only in `src/app/admin/actions.ts`) bypasses
  RLS by design — that's why every use of it is gated behind an explicit
  `role === 'ADMIN'` check in application code first.

## What is explicitly NOT modeled here

See [security-boundaries.md](security-boundaries.md) for the full list.
Nothing in this schema stores passport data, DOB, home address, criminal
history, refusal letters, bank information, or real client case documents —
`topics.question`/`business`/`audience` are short plain-text marketing
fields, not a document or case file store, and there is no file upload
capability.
