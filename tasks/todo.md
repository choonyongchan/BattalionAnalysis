# Open work: Vercel + Neon cut-over

Carried over from the old root `todo.md` / `todo2.md` (removed 2026-09-21); only unchecked items kept.

## Deployment
- [ ] Verify https://40sar.vercel.app signed out: login loads, every page has data, deep links survive reload, light/dark and phone width look right.
- [ ] Decide on `battalion-analysis.vercel.app` (returns `DEPLOYMENT_NOT_FOUND`) and the old `battalion-system` project.
- [ ] `git remote set-url origin https://github.com/choonyongchan/BattalionAnalysis.git`

## FormSG → Vercel
- [ ] Set `DATABASE_URL`, `FORMSG_SECRET_KEY`, `FORMSG_POST_URI=https://40sar.vercel.app/api/formsg` on Vercel; redeploy.
- [ ] Point the FormSG webhook at `/api/formsg` (replaces Plumber); submit a test response and check `report_sick_formsg`.
- [ ] Watch real submissions for a day, then turn Plumber off.

## Parade states → Vercel intake (`api/parade.ts`)
- [ ] Set `PARADE_INGEST_SECRET` and `DASHBOARD_PASSWORD` on Vercel; redeploy.
- [ ] On the runner laptop, replace `.env.whatsapp`'s `DATABASE_URL` / `OPENAI_*` / `PARSE_INTERVAL_MS` with `PARADE_API_URL` and `PARADE_INGEST_SECRET`.
- [ ] Open Parade States on the deployed dashboard: list loads, deposit a test state, edit it, delete it.
- [ ] Live-verify on the runner laptop: dry run → live → relay a real parade state.
- [ ] Run alongside the Apps Script relay for a few days and compare rows before switching it off.

## Dashboard → Neon
- [x] Read API `api/dashboard.ts` behind `DASHBOARD_PASSWORD`, as the read-only `dashboard_read` role (`db/grants-dashboard.sql`).
- [x] `src/data/feed.js` reads it; the Apps Script feed URL and `src/data/config.js` are gone.
- [x] `bun run db:migrate` (replaced the empty old-shape `public_holidays`/`rotations`; `0000` baselined in `drizzle.__drizzle_migrations`, since the live DB was built from the retired `0000_needy_lockheed`).
- [x] `bun --env-file=.env.local scripts/apply-grants.ts db/grants-dashboard.sql`; verified as `dashboard_read`: `body` and writes are denied (URL saved in `.env.local`).
- [ ] Set `DASHBOARD_DATABASE_URL` on Vercel; redeploy.
- [x] Imported `backup/` (2026-09-22): 168 submissions, 2,389 FormSG, 26 holidays; rerun inserted 0. Left out by decision: Scorpion (29 submissions), three submissions with no Strength Data (Braves 07-21, Cougar 09-16, Hercules 09-11), one FormSG row with no Response ID. The three 09-18 submissions already in Neon were kept over the Sheet's copies.
- [ ] Compare a few dates on the deployed dashboard against the Sheet (strength, MC/MA, report sick, ORBAT, holidays, rotations).
- [ ] Retire the Apps Script web app deployment.

## Cleanup
- [ ] Drop `WHATSAPP_INGEST_TOKEN`, `CRON_SECRET` from Vercel env vars. Keep `OPENAI_API_KEY`: the parser's model fallback (`lib/parser/llm.ts`) needs it.
- [ ] Turn off Plumber; archive the Google Sheet read-only.
- [ ] Delete stale branches `cleanup/over-engineering-audit`, `dashboard-revamp`, remote `perm-status-num-days-sentinel`.

## Settings, phase 1 rollout
- [ ] Before merging: check production `public_holidays` has the 2027 holidays; if not, run the old `db/seed-public-holidays.sql` from `main` against production first (the migration carries whatever the table holds into Settings → Calendar, then drops it).
- [ ] Set `SETTINGS_PASSWORD` on Vercel (long, different from `DASHBOARD_PASSWORD`).
- [ ] `bun run db:migrate` (applies 0002 settings + copy, 0003 drop).
- [ ] Re-run `bun --env-file=.env.local scripts/apply-grants.ts db/grants-dashboard.sql` so `dashboard_read` can select `settings`; keep the printed URL.
- [ ] Deploy; on production, check Settings → Calendar lists every holiday and rotation that was in the old tables, and the charts still draw holiday lines.
- [ ] On production, Settings → Calendar must not show "Stored value invalid": a migrated holiday name over 80 characters or rotation name over 40 makes the whole section fall back to defaults; if flagged, shorten the names and save the section.

## Later
- [ ] WhatsApp self-notifier for ingestor health (FormSG + WhatsApp success/failure).
- [ ] Parade-state upload monitor (calendar of which companies submitted) and manual deposit.
