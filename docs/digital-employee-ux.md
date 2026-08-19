# Digital Employee UX (Boss Mode / Admin Mode)

This is a **presentation-layer milestone**. No backend workflow, AI
behaviour, permission logic, database schema, or data was changed to
build this — see "What did NOT change" below. Everything here is a new
way of showing the same underlying system.

## The mental model

The system should not feel like "a software dashboard with modules." It
should feel like **"Leo has a small team of AI digital employees working
for him."** AI employees do the repetitive work; Leo reviews the
important professional decisions; Ryan (ADMIN) manages the system.

The visual style stays extremely minimal and professional throughout —
no robot avatars, no cartoon illustrations, no gamified virtual office,
no colourful AI aesthetic. Think British professional services + a
modern internal operating system, not a consumer app.

## Two view modes

`src/lib/view-mode.ts` — `resolveViewMode(role, cookieValue)`, pure and
unit-tested:

- **EXPERT always sees Boss Mode.** There is no EXPERT preview of Admin
  Mode, and the resolve function never even reads the cookie for EXPERT —
  a tampered cookie cannot grant admin framing.
- **ADMIN defaults to Admin Mode**, and can opt into a **Boss Mode
  preview** via a cookie (`view_mode`, set by
  `src/app/view-mode-actions.ts` → `setViewMode()`), switched from the
  small control next to the user's name in the header
  (`src/components/mode-switch.tsx`).

This is presentation only. It never changes what a user is *allowed* to
do — every existing server-side check (`canRunResearch`,
`canApproveResearch`, `canManageContentAssets`, RLS, etc.) remains the
only source of authorization truth, completely unaware that view modes
exist.

## The four digital employees

Defined once, centrally, in `src/lib/boss-language.ts` →
`DIGITAL_EMPLOYEES`. Exactly four this phase — do not add a fifth
without instruction.

| Letter | Name | "What I do" (shown to Leo) | Backend module | Route |
|---|---|---|---|---|
| A | 选题策划员 | 帮你决定今天最值得做什么内容。 | Topic creation, scoring, prioritisation (`src/lib/scoring.ts`, `src/app/topics/`) | `/team/planner` |
| B | 政策研究员 | 帮你查官方规则、找依据、整理结论。 | Research Agent — real web search, grounding, approval workflow (`src/lib/ai/research-agent.ts`, `research-workflow.ts`) | `/team/researcher` |
| C | 内容编辑 | 把审核过的研究变成视频号、小红书和公众号内容。 | Content Agent — video/Xiaohongshu/WeChat generation (`src/lib/ai/content-agent.ts`, `content-versions.ts`) | `/team/editor` |
| D | 合规审核员 | 专门挑错，检查内容有没有风险。 | **Not implemented.** A truthful "尚未启用" placeholder — see `src/app/team/compliance/page.tsx`. Never fabricates findings. | `/team/compliance` |

**Leo is not employee E.** He's the human professional decision-maker —
visually and conceptually separate, surfaced through a dedicated **Leo
待处理** queue (`/review`), not through an employee card. Possible items:
研究等待确认 (from B), 内容草稿有需确认事项 (from C). Both are grounded in real
data — see "No fabricated numbers" below.

## Employee pages — what each one shows, and where the data comes from

All four are thin presentational layers. None duplicate business logic;
all read through the existing `topics.ts` data-access layer (plus two
new *aggregation-only* functions, see below) and existing pure helpers
(`content-versions.ts`, `permissions.ts`).

- **A 选题策划员** (`/team/planner`) — 高优先级选题 / 待开始选题 / 最近新建选题,
  from `getLibraryTopics()` (unchanged, existing function), filtered by
  `priority`/`status`/`created_at`.
- **B 政策研究员** (`/team/researcher`) — 研究中 / 研究完成等Leo确认 / 已批准研究,
  from `getAllTopics()` (new, thin `select *`) filtered by status, with
  source count + confidence looked up per topic via the existing
  `getLatestResearchPack()`/`getResearchSources()`. **Does not show a
  fabricated "需要Leo确认" count** — instead shows the real confidence
  level, translated via `BOSS_CONFIDENCE_LABEL`.
- **C 内容编辑** (`/team/editor`) — per content-eligible topic
  (`canGenerateContent(status)`, the same gate `content-actions.ts`
  already enforces), shows 视频号/小红书/公众号 status derived from
  `getAllContentAssets()` (new, thin `select *`) grouped by
  `groupContentAssetsByLineage()` (existing, unchanged).
- **D 合规审核员** (`/team/compliance`) — static placeholder, no data.

## Leo's review queue — no fabricated numbers

`src/lib/employee-tasks.ts` → `buildLeoReviewQueue()`, pure and heavily
tested. Two real, existing signals, nothing invented:

1. Every topic at `RESEARCH_READY` — the same state
   `research-actions.ts` already gates approval on.
2. Every topic whose **latest** version of any content asset carries a
   non-empty `expert_review_notes` array — the Content Agent's own
   evidence-boundary flags (`research_gap` / `expert_review_required`),
   built in the Phase 4 milestone specifically so a human would see them.
   Only the latest version counts — a note on a superseded version
   doesn't linger in the queue forever.

If nothing needs Leo, the queue (and the home page's "今天需要你处理"
banner) says so plainly rather than showing an empty/zero state that
looks broken.

## Boss Mode home page (`/`, mode = boss)

`早上好，{name}。你的数字团队正在工作。` (`timeBasedGreeting()` — 早上好 / 下午好 /
晚上好 by server hour), then: a pending-work summary linking to `/review`,
the four employee cards (`EmployeeCard` component — letter marker, name,
one-line responsibility, 2-3 real stats, one primary action; no shadow,
thin border, matches the rest of the app's minimal system), and the Leo
待处理 count summary. No charts, no colourful widgets.

## Admin Mode (`/`, mode = admin)

**Unchanged** operational dashboard (stage-count cards). Nav gains
relabeled/new entries but nothing is removed:

选题库 (`/topics`) · 研究中心 (`/team/researcher`, shared with Boss Mode's B
page) · 可进入拍摄 (`/ready-to-shoot`) · 本周已发布 (`/published`) · 内容工作台
(`/team/editor`, shared with Boss Mode's C page) · 内容资产库
(`/content-assets`, new — flat cross-topic listing of latest content
versions) · 管理 (`/admin`).

Note: the spec's suggested nav also listed a separate "系统设置" entry.
There is no distinct settings functionality in this app (only staff/role
management, already at `/admin`) — rather than build an empty page to
hold a nav item, `/admin` covers both; flagging this scope decision
rather than fabricating a settings page with nothing in it.

## New routes

`/team/planner`, `/team/researcher`, `/team/editor`, `/team/compliance`,
`/review`, `/content-assets` — all new. Every existing route is
unchanged: `/topics`, `/topics/[id]` (including its `?tab=` param, added
so the review queue and Employee C's page can deep-link into the right
tab), `/research-completed`, `/ready-to-shoot`, `/published`, `/admin`,
`/login`.

## New data-access functions (the only additions to `topics.ts`)

`getAllTopics()` and `getAllContentAssets()` — both thin, unfiltered
`select *` queries (with the existing demo-mode fallback pattern), added
because the aggregation views need to look across every topic/asset
rather than one at a time. In-memory filtering via existing pure helpers
(`filterContentEligibleTopics`, `groupContentAssetsByLineage`, etc.) does
the rest — reasonable at this app's internal-tool scale. No new tables,
no new joins, no new business rules.

## What did NOT change

Per instruction, none of the following were touched to build this
milestone: Anthropic API implementation, Research Agent behaviour,
Content Agent behaviour, source grounding/traceability, content
versioning, research approval authorization, ADMIN/EXPERT backend
authorization, Supabase RLS, AI usage logging, activity logging, or any
database migration from a previous phase. Compliance backend was not
started — `/team/compliance` is a UI placeholder only.
