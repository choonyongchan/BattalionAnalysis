# Battalion Analysis

Parade states (WhatsApp) and report-sick submissions (FormSG) into Neon Postgres, and a
read-only dashboard over them, deployed on Vercel.

```sh
bun install
bun run dev          # dashboard
bun test             # everything, no network
bun run db:migrate   # apply db/migrations to DATABASE_URL (.env.local)
```

Environment variables: `.env.example` (app, copy to `.env.local`) and `.env.whatsapp.example` (WhatsApp bridge, copy to `.env.whatsapp`).

- Architecture: [docs/architecture_patterns.md](docs/architecture_patterns.md)
- Dashboard: [docs/dashboard.md](docs/dashboard.md)
- WhatsApp runner: [whatsapp/README.md](whatsapp/README.md)
