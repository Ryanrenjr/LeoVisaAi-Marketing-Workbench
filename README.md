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
`.env.local` and follow "First-run setup" in
[docs/phase-1-plan.md](docs/phase-1-plan.md).

```bash
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test       # vitest
npm run build      # production build
```
