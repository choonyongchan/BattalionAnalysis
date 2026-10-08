# Open work

Done items are deleted, not ticked; git history keeps them. The Vercel + Neon cut-over and the
Settings rollout are finished. On 2026-10-08 the folder split and security fixes shipped: Vercel's
Root Directory is `backend`, `SESSION_SECRET` is set, migration 0007 is applied, and a firewall rule
rate-limits `/api/session` and `/api/parade` to 10 requests a minute per IP.

## After the 2026-10-08 rollout
- [ ] Log in on https://40sar.vercel.app with each password; open every page; deposit, edit and delete a test parade state.
- [ ] Watch the runner relay tomorrow's first parade states (`bun run runner:service status`).

## Dashboard
- [ ] Present, Reporting Sick (parade state), MC/MA and Status trends: a day with no parade state reads 0, not a gap. Verify on the deployed dashboard.
- [ ] Report-Sick Flow: confirm it never reconciles on 4D numbers (rule: no 4D numbers in statistics).

## Deployment
- [ ] Decide on the old `battalion-system` project (still serving `40hercules.vercel.app`).
- [ ] Turn off Plumber and archive the Google Sheet read-only, if not already done.

## Later
- [ ] WhatsApp self-notifier for ingestor health (FormSG + WhatsApp success/failure).
