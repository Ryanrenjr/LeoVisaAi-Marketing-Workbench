# LeoVisaAi 营销工作台

Internal marketing content pipeline tool. Start with
[CLAUDE.md](CLAUDE.md) for the product rules and boundaries, and
[docs/](docs/) for architecture, data model, phase plan, and security
boundaries.

## Local development

```bash
npm install
npm run dev
```

The app runs immediately with demo data — no Supabase project required to
click through it. To connect real data, copy `.env.example` to
`.env.local` and fill in a Supabase project's values (each variable is
documented inline in that file); apply the schema with
`npm run db:migrate` (`npm run db:migrate:dry-run` first to preview). See
[docs/architecture.md](docs/architecture.md) for how the pieces fit
together.

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test       # vitest
npm run build      # production build
```
