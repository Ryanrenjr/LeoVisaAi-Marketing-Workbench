# Phase 1 plan

Phase 1 builds the project skeleton only. **No AI is connected in this
phase** — no Topic AI scoring, no Research AI. That is explicitly deferred
to a future, separately-instructed phase.

## In scope (this phase)

- Project scaffold: Next.js + TypeScript + Tailwind, minimal UI shell.
- Supabase schema + RLS for `profiles`, `topics`, `topic_status_events`.
- Supabase Auth (email/password) with session-based route protection.
- Two-role permission skeleton: `ADMIN`, `EXPERT`.
- Six pages:
  1. `/` — dashboard: create a topic, see draft topics awaiting research, stage counts
  2. `/login` — sign in
  3. `/research-completed` — 研究已完成
  4. `/ready-to-shoot` — 可进入拍摄
  5. `/published` — 本周已发布 (scoped to the current calendar week)
  6. `/admin` — `ADMIN`-only: manage staff roles, view the approval audit log
- Human-approval-gated status transitions (manual button + audit row per
  transition — see [data-model.md](data-model.md)).
- Demo pipeline data (via `supabase/seed.sql`, and a static fallback in
  `src/lib/demo-data.ts` for when Supabase isn't configured yet).

## Explicitly out of scope (do not build without a new instruction)

- Topic AI scoring
- Research AI
- CRM
- Lead Agent
- Case Brain
- Social publishing
- Client chatbot
- Automatic immigration eligibility assessment
- Any storage of the data types listed in [security-boundaries.md](security-boundaries.md)

## Still mocked / demo in this phase

- **Pipeline content**: seeded demo topics, not real marketing content.
- **Staff accounts**: no real staff accounts are created by this phase.
  The first account (and first `ADMIN`) must be created manually — see
  "First-run setup" below.
- **Demo-mode fallback**: if `.env.local` doesn't have real Supabase
  credentials yet, every page falls back to static demo content instead of
  querying a database, so the app is fully click-through-able before any
  infrastructure is provisioned.

## First-run setup (once you have a Supabase project)

1. Copy `.env.example` to `.env.local` and fill in your project's URL,
   anon key, and service role key.
2. Run the migration and seed against your project (via the Supabase SQL
   editor, or `npx supabase db push` / `npx supabase db reset` if you're
   using the Supabase CLI locally).
3. Create your first user from the Supabase Studio "Authentication" tab
   (or have them sign up if self-serve sign-up is enabled). This
   automatically creates a matching `profiles` row with role `EXPERT`.
4. Promote that first user to `ADMIN` with one manual SQL statement:
   ```sql
   update public.profiles set role = 'ADMIN' where email = 'you@example.com';
   ```
   This manual step is intentional — there is no self-service way to become
   an `ADMIN`, by design.

## Acceptance checklist for this round

- App starts locally (`npm run dev`) without a Supabase project configured.
- All six pages listed above exist and render.
- UI is visibly minimal (no chatbot UI, no unrelated widgets).
- Supabase schema exists (`supabase/migrations/0001_init.sql`).
- `ADMIN` / `EXPERT` role skeleton exists (schema + route/action checks).
- No chatbot has been added anywhere.
