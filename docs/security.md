# Data security

Parade states carry names, 4D numbers, ranks and diagnoses; FormSG submissions carry the same
plus free-text symptoms and the doctor's outcome. This page records how that data is protected,
what an audit on 2026-10-07 found, what was fixed, and what is still open. The rules every change
must keep are in [architecture_patterns.md](architecture_patterns.md#rules-that-hold-everywhere).

## Where personal data lives

| Place | What | Who can reach it |
|---|---|---|
| Neon `raw_messages.body`, `.error` | Whole parade-state messages and the parser's doubts | `GET /api/parade?id=` only, one message at a time, to a dashboard session or the dashboard password |
| Neon `personnel_rows`, `report_sick_formsg`, `sft_formsg` | Names, 4D, reasons, symptoms, outcomes | Every dashboard viewer, through `/api/dashboard` as the read-only `dashboard_read` role |
| OpenAI | A message the rule-based parser could not read, NRIC shapes masked, `store: false` | OpenAI, under its API data terms |
| The ops laptop: `runner/auth/`, `.env.whatsapp`, `runner/data/bridge.log` | WhatsApp session keys, the relay secret, message ids | Anyone with the laptop's disk |
| Vercel logs | Route, status, parser timings, error names and driver codes | Vercel project members |

No NRIC is stored anywhere: FormSG NRIC answers are discarded, and a value shaped like one is
refused before it is written.

## Controls

- **Authentication.** Two shared passwords: `DASHBOARD_PASSWORD` (read and deposit) and
  `SETTINGS_PASSWORD` (also edits settings). The browser gets an `HttpOnly`, `Secure`,
  `SameSite=Strict` session cookie, never the password. Cookies are signed with a key derived from
  the password and `SESSION_SECRET`, so one stolen cookie cannot be used to guess the password.
  Writes made with a cookie must be same-origin.
- **Least privilege on reads.** The dashboard reads as `dashboard_read`, which cannot select
  `raw_messages.body` or `.error`.
- **Nothing personal in logs.** `serverError` logs error names and Postgres codes only; FormSG
  warnings name columns, not answers; the runner logs Baileys warnings without their payloads.
- **Nothing personal in lists.** The parade-state list returns an outcome and a count of doubted
  lines; the lines themselves come only with the message, when a clerk opens it.
- **Browser hardening.** `backend/vercel.json` sets a CSP (`script-src 'self'`, no framing),
  `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy` and HSTS. Request
  bodies are capped at 256 KB. Analytics send only the page name.
- **Repository hygiene.** `test/repo-hygiene.test.ts` fails if a tracked file holds an NRIC shape
  (test placeholders have invalid check letters) or if a known personal-data file stops being
  gitignored. `backup/`, `*.csv`, the parade-state samples and the runner's state are ignored.

## Fixed on 2026-10-07

| Finding | Fix |
|---|---|
| Failed queries logged their bound params (bodies, names, 4D) to Vercel | `backend/lib/http.ts#describeError` |
| The parade-state list returned the parser's quoted lines for every failed message | `listMessages` returns `outcome` and `problems` |
| FormSG logged unrecognised answer text, including the doctor's outcome | Column names only |
| Session cookies were signed with the password, an offline guessing oracle | `SESSION_SECRET` pepper |
| Full message text, NRICs included, went to OpenAI with default retention | NRIC masking, `store: false` |
| No security headers; inline script | Headers in `backend/vercel.json`; `public/theme.js` |
| Unbounded request bodies | 256 KB cap |
| Runner log held phone numbers, JIDs and display names | `baileysLogger` |
| `apply-grants.ts` printed the role password to the terminal | Written to a gitignored file |
| A stray `parade_ingest` login role with write grants, and an unused `auth_failures` table | Migration `0007` |
| Test fixtures held a checksum-valid NRIC and realistic names | Replaced |

## Open, by decision

- **Rate limiting is coarse.** A Vercel Firewall rule allows 10 requests a minute per IP on
  `/api/session` and `/api/parade` (added 2026-10-08), but nothing locks an account after failed
  logins, so the passwords must still be long.
- **Whole history to every viewer.** `/api/dashboard` returns every record since the import to
  anyone with `DASHBOARD_PASSWORD`. Narrowing it means a date window or per-column grants.
  Since 2026-10-08 the dashboard also draws per-soldier health patterns from that same data
  (Outbreak Watch names, MC Pattern by soldier, SFT While Restricted); nothing new leaves the
  database except `section_counts`, which holds counts and no names.
- **Writes run as the owner role.** The intake and webhooks use `DATABASE_URL` (`neondb_owner`).
  A write-only role per route would limit what a bug could do.
- **No retention policy.** Messages, reasons and FormSG rows are kept indefinitely.
- **No audit trail.** There are no accounts, so nothing records who read, edited or deleted.
- **Git history.** Older commits on GitHub contain realistic-looking names from earlier parser
  prompts. Removing them needs a history rewrite and a force-push.
- **Third-party processing.** Confirm military personnel data may go to OpenAI (US), and whether
  the organisation has zero data retention.
- **The ops laptop.** `runner/auth/` is a full WhatsApp account takeover if copied. Keep the disk
  encrypted and outside any sync folder; truncate `bridge.log` from before 2026-10-07, which still
  holds phone numbers.
