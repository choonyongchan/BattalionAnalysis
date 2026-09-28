# Lessons

- Re-running `db/grants-dashboard.sql` rotates the `dashboard_read` password. Update
  `DASHBOARD_DATABASE_URL` on Vercel (Production, sensitive) in the same step as `.env.local`,
  then redeploy — otherwise every `/api/dashboard` call 500s with "Failed query" (2026-09-24).
- A commit that adds `db/migrations/*.sql` needs `bun run db:migrate` against prod before (or with)
  the Vercel deploy. `0006_parse_timing` shipped in code on 2026-09-25 but was never applied, so every
  `/api/parade` POST (relay and dashboard) 500'd on the missing `raw_messages.parser` column and the
  bridge logged `relay failed ... intake answered 500` (2026-09-28).
