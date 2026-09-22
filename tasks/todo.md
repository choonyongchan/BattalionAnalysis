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

## WhatsApp → local runner
- [ ] Create the `parade_ingest` role (`scripts/apply-grants.ts db/grants-ingest.sql`).
- [ ] Live-verify on the runner laptop: dry run → live → crash recovery.
- [ ] Run alongside the Apps Script relay for a few days and compare rows before switching it off.

## Dashboard → Neon
- [ ] Read API on Vercel behind `DASHBOARD_PASSWORD`, using a read-only role (needs a grants file; `db/grants.sql` does not exist yet).
- [ ] Repoint `src/data/feed.js` / `src/data/config.js` at it and remove the Apps Script feed URL.

## Cleanup
- [ ] Drop `WHATSAPP_INGEST_TOKEN`, `CRON_SECRET`, `OPENAI_API_KEY` from Vercel env vars.
- [ ] Turn off Plumber; archive the Google Sheet read-only.
- [ ] Delete stale branches `cleanup/over-engineering-audit`, `dashboard-revamp`, remote `perm-status-num-days-sentinel`.

## Later
- [ ] WhatsApp self-notifier for ingestor health (FormSG + WhatsApp success/failure).
- [ ] Parade-state upload monitor (calendar of which companies submitted) and manual deposit.
