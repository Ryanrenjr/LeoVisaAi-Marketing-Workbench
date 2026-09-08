> **HISTORICAL** — describes an earlier phase of this project's build-out
> and may not reflect current behavior. See CLAUDE.md and
> [docs/architecture.md](architecture.md) for the current source of truth.

# Phase 2 plan — Topic Library (选题库)

This milestone builds the real topic model on top of the Phase 1
skeleton. **No AI is connected in this phase either** — scoring is a
deterministic formula, not AI, and "开始研究" only flips a status; it does
not run any research.

## In scope (this milestone)

- Extended `topics` schema: `code`, `question`, `business`, `audience`,
  `content_pillar`, `priority`, `topic_score`, `score_breakdown` (see
  [data-model.md](data-model.md)).
- Status pipeline extended with `RESEARCHING` and `ARCHIVED`; existing
  values renamed to uppercase for consistency (`IDEA`, `RESEARCH_COMPLETED`,
  `READY_TO_SHOOT`, `PUBLISHED`).
- `topic_activity_log` — append-only activity feed with exactly six
  activity types: `topic_created`, `topic_edited`, `topic_scored`,
  `score_manually_changed`, `research_requested`, `topic_archived`.
- Three new pages: `/topics` (library list), `/topics/new` (create),
  `/topics/[id]` (detail — fields, score breakdown, activity history,
  actions), `/topics/[id]/edit` (edit).
- Actions: 编辑, 重新评分 (deterministic recompute), 开始研究 (`IDEA` →
  `RESEARCHING`, human-approval-gated), 归档 (`* → ARCHIVED`, `ADMIN`-only).
- Six synthetic UK-immigration seed topics (no real client data).

## Explicitly out of scope (do not build without a new instruction)

- Research AI (actually researching a topic)
- Content AI
- Compliance
- `CONTENT_DRAFT` / `LEO_REVIEW` / `APPROVED` stages — not added to the
  status enum yet; nothing in this milestone transitions into them.

## Assumptions made this milestone (flagging for confirmation)

- **EXPERT** can create/edit/rescore/start research; **only ADMIN can
  archive** — this is the concrete ADMIN-authorization boundary the tests
  cover. Say if you wanted a different split.
- `content_pillar` is a placeholder 5-value taxonomy
  (`policy_update`/`myth_busting`/`how_to`/`case_study`/`news`), not
  sourced from any external spec.
- The topic score formula (priority weight + field-completeness bonus) is
  a stand-in for editorial readiness, not a claim about which topics will
  actually perform well — replacing it with something smarter is exactly
  the kind of change a future "Research AI" milestone would make.

## Still mocked / not fully testable without a connected Supabase project

- **Demo mode is read-only.** With no `.env.local`, `/topics`, `/topics/[id]`
  etc. render fine with static demo data, but create/edit/rescore/start
  research/archive are all disabled — there is no authenticated user and
  no persistent store to write into in demo mode. Testing the full
  创建 → 打分 → 修改 → 开始研究 flow end-to-end requires a connected
  Supabase project (see [phase-1-plan.md](phase-1-plan.md) "First-run
  setup").
- This sandbox has no Docker/local Postgres available, so the migration
  SQL and the full auth+RLS flow were verified by careful reading and by
  running the app against demo data, not by executing the migration
  against a real database. Recommend running `npx supabase db reset` (or
  applying `0001_init.sql` + `0002_topic_library.sql` + `seed.sql` via the
  Supabase SQL editor) and re-testing the flow before treating this as
  production-verified.

## Acceptance checklist for this round

- `/topics/[id]` shows: code, title, question, business, audience, content
  pillar, priority, topic score, score breakdown, current status, activity
  history.
- Actions available: 编辑, 重新评分, 开始研究, 归档.
- "开始研究" moves `IDEA → RESEARCHING` and logs `research_requested`
  (both in `topic_activity_log` and `topic_status_events`) — no AI runs.
- Activity log covers all six required types.
- Six synthetic seed topics exist, no real client data.
- `npm run lint`, `npm run typecheck`, `npm run test` all pass.
