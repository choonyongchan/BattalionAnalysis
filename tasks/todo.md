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
- [ ] `bun run db:migrate` (adds `public_holidays`, `rotations`).
- [ ] `bun --env-file=.env.local scripts/apply-grants.ts db/grants-dashboard.sql`; check as `dashboard_read` that `select body from raw_messages` fails.
- [ ] Set `DASHBOARD_DATABASE_URL` on Vercel; redeploy.
- [ ] Export every Sheet tab to CSV (outside the repo); `scripts/import-sheet.ts <dir> --dry-run`, review rejections, then run it for real; rerun to confirm 0 inserted.
- [ ] Compare a few dates on the deployed dashboard against the Sheet (strength, MC/MA, report sick, ORBAT, holidays, rotations).
- [ ] Retire the Apps Script web app deployment.

## Cleanup
- [ ] Drop `WHATSAPP_INGEST_TOKEN`, `CRON_SECRET`, `OPENAI_API_KEY` from Vercel env vars.
- [ ] Turn off Plumber; archive the Google Sheet read-only.
- [ ] Delete stale branches `cleanup/over-engineering-audit`, `dashboard-revamp`, remote `perm-status-num-days-sentinel`.

## Later
- [ ] WhatsApp self-notifier for ingestor health (FormSG + WhatsApp success/failure).
- [ ] Parade-state upload monitor (calendar of which companies submitted) and manual deposit.
