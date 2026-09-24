# Lessons

- Re-running `db/grants-dashboard.sql` rotates the `dashboard_read` password. Update
  `DASHBOARD_DATABASE_URL` on Vercel (Production, sensitive) in the same step as `.env.local`,
  then redeploy — otherwise every `/api/dashboard` call 500s with "Failed query" (2026-09-24).
