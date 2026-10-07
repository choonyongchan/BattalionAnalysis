# Open work

Done items are deleted, not ticked; git history keeps them. The Vercel + Neon cut-over and the
Settings rollout are finished (2026-10-07: every env var is set on Vercel, migrations 0000–0006
are applied, `WHATSAPP_INGEST_TOKEN` and `CRON_SECRET` are gone, stale branches are deleted).

## Dashboard
- [ ] Present, Reporting Sick (parade state), MC/MA and Status trends: a day with no parade state reads 0, not a gap. Verify on the deployed dashboard.
- [ ] Report-Sick Flow: confirm it never reconciles on 4D numbers (rule: no 4D numbers in statistics).

## Deployment
- [ ] Decide on the old `battalion-system` project (still serving `40hercules.vercel.app`).
- [ ] Turn off Plumber and archive the Google Sheet read-only, if not already done.

## Later
- [ ] WhatsApp self-notifier for ingestor health (FormSG + WhatsApp success/failure).
