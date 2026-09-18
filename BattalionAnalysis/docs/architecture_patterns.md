# Architecture patterns — BattalionAnalysis

Canonical map of the refactored project (Vercel + Neon). Update it whenever a layer or
ownership boundary changes. The legacy Apps Script system in the parent directory is
the reference for behaviour being ported, not a dependency.

## Layout: one Vercel project, three layers

| Layer | Path | Runtime |
|---|---|---|
| Frontend | `index.html`, `vite.config.js`, `src/` | Browser — Preact + Vite, copied verbatim from `../dashboard` |
| Backend | `api/*.ts` | Vercel Functions, one file per route |
| Database | `db/schema.ts`, `db/index.ts` | Neon Postgres via Drizzle (`neon-http` driver) |
| WhatsApp relay | `whatsapp/` (workload 1) | Long-running Bun process on the operator's Windows machine |

One `package.json`, one deploy, no workspaces. Vercel Root Directory = `BattalionAnalysis`,
framework preset Vite.

## Dependency direction

- `src/` → `api/` over HTTP only. The frontend holds no credential and imports nothing
  from `api/` or `db/`.
- `api/` → `db/`. Only `api/` touches the database.
- `whatsapp/` → `api/whatsapp` over HTTP only. It stays a thin relay, so parsing, DB
  writes and statistics live in exactly one place, and neither the OpenAI key nor the
  database URL sits on the Windows machine.

## Rules

- **`db/schema.ts` is the single source of truth.** Migrations (`drizzle-kit`) and row
  types are generated from it, never the reverse.
- **Idempotency lives in the database.** Every intake id (`wa_message_id`, FormSG
  response id) is a `UNIQUE` constraint, and inserts use `on conflict do nothing`.
- **`src/model/` stays pure.** No DOM, no network. That is what lets workload 3 run the same
  functions server-side to precompute statistics.

## Roadmap

1. Workload 4 — tables + migrations + one-off backfill from the Sheets CSV exports.
2. Workload 2 — `api/formsg.ts`.
3. Workload 1 — `whatsapp/` relay + `api/whatsapp.ts` with the OpenAI parser.
4. Workload 3 — precomputed `stats`, refreshed after each ingest.
5. `api/dashboard.ts`, then switch `src/data/feed.js` to it.

## Testing

`bun test` runs `test/`, the dashboard model tests. `episodes`, `metrics` and `schema`
tests were left behind: they depend on the Apps Script harness, and they return in
workload 4 with fixtures built from `db/schema.ts`.
