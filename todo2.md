# Next steps: Vercel + Neon cut-over

State on 2026-09-21: `main` is at `e12833a` and deployed to production at
https://40sar.vercel.app. The dashboard is a static Vite build that still reads from the Apps
Script feed (`src/data/config.js`). `api/formsg.ts`, `api/whatsapp.ts` and `api/parse-due.ts`
are deployed but have no environment variables yet, so they answer 503/500. Nothing live
writes to Neon yet.

## 1. Verify the deployment still works

- [ ] Open https://40sar.vercel.app while signed out of Vercel. The login page loads with no
      Vercel SSO redirect.
- [ ] Log in with the dashboard password. Every page loads data from the Apps Script feed,
      with no console errors. Check a deep link such as `/#/report-sick` after a reload.
- [ ] Check light/dark mode and a phone-width layout.
- [ ] Decide on `battalion-analysis.vercel.app`. It currently returns `DEPLOYMENT_NOT_FOUND`.
      Either re-add it under Project → Settings → Domains, or leave `40sar.vercel.app` as the
      only URL and update any bookmarks.
- [ ] Decide what happens to the `battalion-system` project, which listed `40sar.vercel.app`
      before this project took the alias.
- [ ] Point the local remote at the renamed repo:
      `git remote set-url origin https://github.com/choonyongchan/BattalionAnalysis.git`
- [ ] Optional: install the GitHub CLI (`gh`) so changes can go through PRs.

## 2. Shift FormSG to the new deployment

- [ ] Set Vercel production env vars: `DATABASE_URL`, `FORMSG_SECRET_KEY`, and
      `FORMSG_POST_URI=https://40sar.vercel.app/api/formsg`. This must byte-match what is
      registered in FormSG.
- [ ] Redeploy, since env var changes only apply to new deployments.
- [ ] In FormSG admin → Settings → Webhooks, set the webhook URL to
      `https://40sar.vercel.app/api/formsg`. That replaces Plumber.
- [ ] Submit a test response. Check it appears in `formsg_submissions` and that the Vercel
      function log shows a 2xx.
- [ ] Watch real submissions for a day before turning Plumber off.

## 3. Shift WhatsApp to the new setup (parser moves to the local runner)

Plan: `docs/superpowers/plans/2026-09-21-local-parade-state-parser.md`

- [ ] Tasks 1–3: ingestor, config, wiring. The runner writes to Neon through `lib/pipeline.ts`.
- [ ] Task 4: create the `parade_ingest` Neon role (`db/grants-ingest.sql`).
- [ ] Task 5: live verification on the runner laptop (dry run → live → crash recovery).
- [ ] Run the new runner alongside the old Apps Script relay for a few days and compare rows,
      before switching the old one off.

## 4. Move the dashboard to Neon

The dashboard still reads Apps Script, so Neon data is invisible until this is done
(`todo.md`, Workflow 5).

- [ ] Add a read API on Vercel using `getReadDb()` (`DATABASE_URL_READONLY`, the
      `dashboard_reader` role from `db/grants.sql`) behind `DASHBOARD_PASSWORD`.
- [ ] Repoint `src/data/feed.js` / `src/data/config.js` at it.
- [ ] Apply `db/grants.sql` and set `DATABASE_URL_READONLY` and `DASHBOARD_PASSWORD` on Vercel.

## 5. Remove old code

Only once steps 2–4 have run clean for a while.

- [x] Plan Task 6: delete `api/whatsapp.ts`, `api/parse-due.ts` and their tests. Drop
      `WHATSAPP_INGEST_TOKEN`, `CRON_SECRET` and `OPENAI_API_KEY` from `.env.example`.
- [ ] Drop `WHATSAPP_INGEST_TOKEN`, `CRON_SECRET` and `OPENAI_API_KEY` from Vercel.
- [x] Plan Task 7: rewrite `docs/architecture_patterns.md` for the Vercel + Neon layout.
- [ ] Plan Task 7: update `whatsapp/README.md` (still describes the Apps Script relay).
- [x] Delete `legacy/` (Apps Script) and the `@google/clasp` devDependency. Remove
      `.clasp.json` locally.
- [ ] Remove the Apps Script feed URL from `src/data/config.js`.
- [ ] Turn off Plumber, and archive the Google Sheet as read-only.
- [ ] Delete the stale local branches (`cleanup/over-engineering-audit`, `dashboard-revamp`)
      and remote `perm-status-num-days-sentinel` if they are no longer needed.
