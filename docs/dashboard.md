# Battalion Personnel Dashboard

A dashboard over the Neon database the parade-state and FormSG pipelines write to.

## What it is for

Seven pages, in the order a commander reads them:

| Page | Answers |
|---|---|
| **Overview** | Who has filed a parade state this morning, and when? How many do I have, how many turned up, and why is the rest missing? Are my officers there? How many will I have next week, and who is back when? |
| **Report sick** · **MC / MA** · **Status** | Is it getting worse? Which company? Which platoon? Who, most often? |
| **Soldier** | How often has this man been out, and how long was each episode? |
| **ORBAT** | Who is on duty today, from the CDO down, and which chairs were filed vacant? |
| **Settings** | What is the dashboard reading, and how much of the battalion does it cover? |

The three medical pages are one layout asked three times. That is deliberate: the layout
is learned once and read three times, and the three categories become comparable because
they are presented identically. They are built from one set of sections
([`src/pages/shared/category.jsx`](src/pages/shared/category.jsx)) so they cannot
drift apart; each page lists the sections it shows, in order.

**Every comparison is a rate, never a count.** Braves files 40 MC rows against Hercules'
7 in the labelled data, which says nothing until divided by strength — Braves is the
larger company. Company and platoon panels therefore show the percentage of the days a
unit was observed, with a z-score against the battalion rate deciding what gets flagged.

**Every chart states its coverage.** In the observed data only 5 of 45 parade days carry
all six companies, and the two sources cover different spans — parade state from
2026-07-11, FormSG from 2026-05-07 — so "all time" means different things on adjacent
cards. Each panel prints its own coverage as a fraction with both parts, and the Settings
page collects them all in one place.

## How it reads the data

The data **stays private**. Nothing is published, and no battalion data is committed to
this repo or passes through the deploy workflow.

The page asks one Vercel Function on the same deployment for everything it charts:

```
browser  --POST password-->  /api/session  --Set-Cookie: session (HttpOnly, 12h)-->  browser
browser  --GET, session cookie-->  /api/dashboard  --SELECT as dashboard_read-->  Neon
```

The password is checked **there**, in [`api/session.ts`](../api/session.ts), against
`DASHBOARD_PASSWORD` before any session is issued, and
[`api/dashboard.ts`](../api/dashboard.ts) checks the session before a single row is read.
A wrong password gets a 401, no cookie and no data.
A password checked in the browser instead would be decoration: the page's JavaScript is
public, so anyone could read past the check.

The route connects as `dashboard_read` ([`db/grants-dashboard.sql`](../db/grants-dashboard.sql)),
a role that can only `SELECT` the tables the dashboard charts and cannot read
`raw_messages.body` at all. [`lib/dashboard.ts`](../lib/dashboard.ts) answers with the tabs the
retired Google Sheet held, under the same names and headers, so everything in `model/`
reads it unchanged.

**Anyone who knows the password can see everything.** There is no per-person identity, no
record of who looked, and no way to revoke one viewer: removing someone means changing the
password for everyone. That is the trade for having no accounts to manage.

## One-time setup

**1. Pick the password.** A long random passphrase: it is the only thing in front of the
data, and the route has no lockout, so length is the whole defence.

```bash
openssl rand -base64 24                       # Git Bash / macOS / Linux
```
```powershell
$b = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
[Convert]::ToBase64String($b)                 # PowerShell
```

Both draw from the OS cryptographic generator. `Get-Random` does not — do not use it
for this.

**2. Create the read-only role.** After `bun run db:migrate`:

```bash
bun --env-file=.env.local scripts/apply-grants.ts db/grants-dashboard.sql
```

It prints `dashboard_read`'s connection string. Re-running rotates its password.

**3. Set both on Vercel** (Project Settings → Environment Variables), then redeploy:
`DASHBOARD_PASSWORD` (the passphrase) and `DASHBOARD_DATABASE_URL` (the printed string).
The route fails closed: until both exist it answers 503 to everyone, including an empty
password.

**4. Import the Sheet history once.** Download each tab of the old spreadsheet as CSV
(File → Download → CSV) into one folder outside the repo, then:

```bash
bun --env-file=.env.local scripts/import-sheet.ts <folder> --dry-run   # counts only
bun --env-file=.env.local scripts/import-sheet.ts <folder>             # writes
```

The dry run reports rows read and rejected per tab, by CSV row number; check the rejections
before writing. Parade states already in Neon win, and re-running inserts nothing new. The
message-body and NRIC columns are never read.

**5. Holidays and rotations.** `public_holidays (date, name)` and `rotations (name,
start_date, end_date)` are seeded by the import and maintained afterwards with SQL in the
Neon console. Until they have rows, the Settings page says so, no holiday lines are drawn,
and there is no rotational grouping. Everything else works without them.

`db/seed-public-holidays.sql` holds the MOM-gazetted Singapore holidays for 2025-2027,
including each in-lieu Monday. Paste it into the Neon SQL editor (it is idempotent and
never overwrites a name edited by hand), and extend it as new years are gazetted.

**Then share the password with the CO, S1 and S3.** Not by anything that keeps a searchable
copy forever if you can help it.

### Rotating it

Change `DASHBOARD_PASSWORD` on Vercel and redeploy. Every open session was signed with the
old password, so all of them stop verifying at once: each dashboard is refused on its next
background refresh, within a minute, and asks for the new password.

## Running it locally

```
bun install
vercel dev                       # serves the page and /api together; needs .env.local
```

```
bun test                         # from the repo root: model layer, routes, and importer
```

`bun run dev` serves only the page, with no `/api`, so it cannot log in; use `vercel dev`
with `DASHBOARD_PASSWORD` and `DASHBOARD_DATABASE_URL` in `.env.local`, or a preview deploy.

### Why there is a build step now

There did not used to be one, and losing that was a real cost. It is here because eight
pages of legend toggles, granularity radios, a fuzzy combobox and a live light/dark switch
are more state than an imperative DOM layer carries without turning into a hand-rolled
framework — and because the chart palette is read from CSS custom properties, which a
runtime theme switch has to be able to re-read. What it bought back: ECharts arrives as an
npm dependency and is tree-shaken to the series actually used, instead of a 1 MB CDN file
pinned by a hash that had to be recomputed on every version bump.

## Deploying

Vercel builds and serves the app from the repository root. `vercel.json` pins the settings
the project would otherwise take from its dashboard: the Vite preset, `bun install`,
`bun run build`, and `dist/` as the output directory. Without it the project fell back to
the "Other" preset, which serves the root as-is, so a deploy "succeeded" with nothing to
serve. Pushing a branch gives a preview deployment; merging to `main` deploys production.

`vite.config.js` sets no `base`: Vercel serves from the domain root, so the default
absolute asset URLs are correct. Routing uses the URL hash, so no SPA rewrites are needed.

## How it is put together

Five layers, and the dependency direction runs strictly downward through them.

```
index.html            the mount point, and a theme-boot script that runs before first paint
src/
  main.jsx            stylesheet order, then mount
  app/                the frame: Shell, Sidebar, Router, routes, Logo, icons
    state.js          every signal the pages read
    auth.js           the password's whole life, from typed to forgotten
  theme/              tokens.css (both themes) · base · controls · shell · components
    useTheme.js       light / dark / system, persisted, and the charts' re-tint trigger
  data/               feed.js (the one GET to /api/dashboard) · parade.js (/api/parade)
    tabs.js           what the dashboard asks each tab for
    records.js        raw values -> typed records, resolved by header name
  model/              every number and every rule. Pure, no DOM, no network, all tested
  charts/             ECharts wrappers; theme.js reads the tokens off the document
  components/         tiles, cards, tables, the date picker, the toggles, the search box
  pages/              one file per page; pages/shared/ for what the medical pages share
```

`model/` is the layer that matters. It is the only one under test, the only one a wrong
number can come from, and the reason a page can be rewritten without re-deriving a single
metric. A page that computes something itself instead of asking `model/` for it is the
defect that layering exists to prevent.

The server half is [`api/dashboard.ts`](../api/dashboard.ts), which reads through
[`lib/dashboard.ts`](../lib/dashboard.ts).

Browser tests are in [`test/dashboard/`](../test/dashboard); the read route's are
[`test/api/dashboard.test.ts`](../test/api/dashboard.test.ts) and
[`test/lib/dashboard.test.ts`](../test/lib/dashboard.test.ts).

## Three things worth knowing before reading the numbers

**`Att C` is MC.** Attend C means excused all duties, which in national service normally
means resting at home on a medical certificate. MC is therefore a category match, never a
text search — a text search would miss `Att C` rows written `HL` or `FEVER`, and would
wrongly count the `AFMC` rows (Air Force Medical Centre appointments, filed under
`Others`). Both directions are pinned by tests.

**Status is not absence.** `Status` is Attend B / light duty: present, excused specific
activities. It has its own tile and is never folded into an absentee count.

**Duration is reported, never derived.** Some messages state a day count that contradicts
their own date range. The dashboard shows the stated figure, records which source each
duration came from, and flags the disagreement — it does not quietly pick a winner. See
`ParserRows`' header for why deriving the count would be wrong exactly where it fires.

## Looking ahead

The Overview's **Next 7 Days** section is the one forward-looking view: **Returning to Duty**,
the soldiers on MC or leave on the selected parade with the day each is expected back, soonest
first. A soldier is back the day after his stated end date, and `From` is the earliest stated
start, which is later than the parade date for an absence booked ahead. Only MC (`Att C`) and
`Off/Leave` are listed. MA is a timed appointment later the same day, so the soldier is on
parade; counting MA and Others put 51 soldiers off parade on 22 Sep 26 against the 28 the
strength figures reported, while MC and leave gave 23. A soldier listed twice is one row, back
only when both absences end, and an absence with no end date reads `Not stated` rather than a
guessed day. The rules are in `src/model/projection.js`.

**Presence by Rank** splits the day's presence into officers, WOSpecs and enlistees from the
strength block's own split, so a company at 90% missing half its officers shows it.

## What is deliberately not here

- **No NRIC.** Neon has no NRIC column, and `SingPass Validated NRIC` and `Masked NRIC` are
  never requested.
- **No writes from the charts.** `/api/dashboard` connects as a role that can only read. The
  one page that writes, Deposit, writes through `/api/parade` (see below).
- **No stored password.** The password is sent once, to `/api/session`, and what comes
  back is a signed, 12-hour session token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  cookie. Nothing in the page can read it — not injected script, not the person at the
  keyboard — and the password itself is never written to `localStorage`, `sessionStorage`
  or a cookie. A refresh therefore does not ask again, while the standing risk is only
  that an unlocked browser can open the dashboard until the session expires. **Lock**
  ends it at the server, and rotating `DASHBOARD_PASSWORD` ends every open session,
  because the token is signed with it.
- **No per-viewer identity.** The token names nobody: there are still no accounts, no
  record of who looked, and no way to revoke one viewer.
  While open, the page re-reads `/api/dashboard` every minute the tab is visible and as
  soon as a hidden tab is shown again, swapping the data in without leaving the page. That
  read is also where an ended session is noticed: the login screen returns.
- **No FormSG doctor outcome.** `report_sick_formsg.outcome`, `mc_days` and the five
  status columns are mapped at ingest but arrive blank on every submission (0 of 39 in
  Sep 26): soldiers file the form before they see the MO. Nothing charts them until the form
  collects the outcome, and `genuine` is never charted, for the reason below.
- **No inference about intent.** The leaderboards rank by episode count and days lost.
  They report what was recorded and nothing else — a soldier managing a chronic condition
  and a soldier avoiding training appear the same way, and the difference is a
  conversation, not a number. A weighted score (Bradford Factor) was built and then
  removed: it needed a paragraph beside every table explaining what it must not be used
  for, which is a poor trade for a ranking two plain columns already give you.
- **No session filter.** Every parade state stored is a first parade, so a control
  offering one option is furniture.
- **Date range, scoped to the aggregates only.** The range control is one calendar
  button in the page bar, beside the company switch (All plus the five companies, one
  segmented row). Its popover holds the quick ranges (This week / Last week / This month /
  Last month / All) beside a two-click month grid; closed, it shows only the committed
  range. It bounds every trend, rate and
  leaderboard so they all cover one named span; it defaults to All. The Today view and
  the masthead describe a single parade and ignore the range, and the parade-date
  selector's options narrow to the dates inside it — so a "today" figure never sits
  under a span the reader has to remember.

## Deposit

`src/pages/Deposit.jsx`, at `#/deposit`. A clerk pastes a parade state WhatsApp
missed and presses Deposit; below it, every stored message (WhatsApp or manual) is listed
newest first with its key, status, source and receipt time, and can be edited or deleted.

- **Where it writes.** `/api/parade` on the same Vercel deployment (`src/data/parade.js`), with
  the session cookie from `/api/session`. A cookie-authorised write must be same-origin, so
  a forged cross-site form cannot deposit or delete.
- **Statuses.** Parsed (rows exist), Needs review (the parser doubted a line; the reasons are
  shown under the status), Rejected (a last parade state, or not a parade state), Pending
  (stored, never parsed). Rules in `src/model/paradeMessages.js`.
- **Edit** loads the stored text into the form. Saving re-parses it; if it parses, the text
  and every row derived from it are replaced together, and if not, nothing changes and the
  reasons are shown. **Delete** asks once more inline, then removes the message and its rows.
- **Charts.** They read the same tables, so a deposit reaches them on the next refresh.
- **Local development.** `bun run dev` serves no `/api`, so neither login nor this page can
  reach the server. Use `vercel dev`, or a deployed preview.
