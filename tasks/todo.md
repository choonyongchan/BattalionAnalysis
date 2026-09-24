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
In this order:
- [ ] **Preview check.** Push the branch (ask first: it publishes it) and open its Vercel preview, with `SETTINGS_PASSWORD` set for Preview and a database the migrations were applied to (not production). Check: `DASHBOARD_PASSWORD` login shows Settings read-only ("Editing is locked", no Edit); unlocking with `DASHBOARD_PASSWORD` is refused, with `SETTINGS_PASSWORD` shows Edit; Unit rename + logo follows in sidebar, header, tab title and Duty root card; Calendar field errors, overlap warning, holiday line on the Overview trend; Thresholds (leaderboard size 3, long-term MC "≥7 days"); a stale second tab's save says "Someone else saved this section."; Reset returns "40 SAR" and the crest; no sideways scroll at 375px.
- [ ] **Before migrating, read-only:** on production run `SELECT hash FROM drizzle.__drizzle_migrations` and confirm 0000, 0001 and 0002_sft_formsg are each recorded by their LF or CRLF hash (the migrator accepts either; 0000 LF `4281406c…`, 0001 LF `bef51ce4…` / CRLF `9c9e53b7…`, 0002_sft LF `71cd092a…` / CRLF `48f8aee6…`). If 0001 shows neither, stop: the migrator would re-run it.
- [ ] If production `public_holidays` lacks the 2027 dates, run the old `db/seed-public-holidays.sql` from `main`'s history against production first (0003 carries whatever the table holds into Settings → Calendar; 0004 then drops it).
- [ ] Set `SETTINGS_PASSWORD` on Vercel (long, different from `DASHBOARD_PASSWORD`).
- [ ] `bun run db:migrate` (0003 settings + copy, 0004 drop, 0005 grant), then merge immediately. Expect up to ~2 minutes of dashboard errors while Vercel deploys: the old code reads the dropped tables, the new code needs `settings`.
- [ ] Do **not** re-run `scripts/apply-grants.ts`: 0005 grants `dashboard_read` SELECT on `settings`, and re-running apply-grants rotates `dashboard_read`'s password, breaking the dashboard until `DASHBOARD_DATABASE_URL` is updated.
- [ ] On production, Settings → Calendar lists every holiday and rotation that was in the old tables, with the right names, and is not flagged "Stored value invalid" (a migrated holiday name over 80 characters or rotation name over 40 makes the whole section fall back to defaults; if flagged, shorten the names and save the section). The charts still draw holiday lines.
- [ ] If 0003 fails midway, `DROP TABLE settings` and re-run `bun run db:migrate`.

## Later
- [ ] WhatsApp self-notifier for ingestor health (FormSG + WhatsApp success/failure).
- [ ] Parade-state upload monitor (calendar of which companies submitted) and manual deposit.
