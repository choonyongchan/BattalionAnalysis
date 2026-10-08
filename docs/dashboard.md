# Battalion Personnel Dashboard

A dashboard over the Neon database the parade-state and FormSG pipelines write to.

## What it is for

The pages, in the order a commander reads them:

| Page | Answers |
|---|---|
| **Today** | Who has filed a parade state this morning, and when? How many do I have, how many turned up, and why is the rest missing? What are the other duties? Who cannot do what? Are my officers there? How many will I have over the next two weeks, and who is back when? |
| **Duty Roster** | Who is on duty today, from the CDO down, and which chairs were filed vacant? Is duty spread fairly, and was anyone rostered while on MC or leave? |
| **Report Sick** · **MC / MA** · **Status & Restrictions** | Is it getting worse? Which company? Which platoon? Who, most often? Plus: is something spreading (Report Sick); when do MCs start, who has many short MCs against few long ones, how long do MCs run (MC / MA); who did SFT while restricted (Status & Restrictions). |
| **Trends** | How have strength, report sick (both sources), MC / MA and Status moved over the range, and how does report sick flow into FormSG outcomes? |
| **SFT** | How many soldiers have done self-regulated fitness training, and how many today? Which company? Where, doing what, and in how big a group? |
| **Soldier** | How often has this soldier been out, and how long was each episode? |
| **Filing & Accuracy** | Do companies file on time? Do the section counts match the names listed? How much of the battalion does the data cover? |
| **Deposit** · **Settings** | Deposit or correct a parade state or SFT record; change what the dashboard is set up for. |

Old links still work: `#/overview` opens Today and `#/status` opens Status & Restrictions
(`ROUTE_ALIASES` in `frontend/src/app/routes.js`).

The three medical pages are one layout asked three times. That is deliberate: the layout
is learned once and read three times, and the three categories become comparable because
they are presented identically. They are built from one set of sections
([`frontend/src/pages/shared/category.jsx`](frontend/src/pages/shared/category.jsx)) so they cannot
drift apart; each page lists the sections it shows, in order.

**Every comparison is a count of soldiers, never a rate.** Commanders read whole soldiers,
so no chart shows a per-100 rate, and no statistic uses 4D numbers. Company and platoon
panels show distinct soldiers and episodes; a bigger company sits higher for being bigger,
and the card says so.

**Each chart type answers one kind of question.** A trend over days is a line, with weekends
banded, holidays ruled and each company's line named where it ends. A ranking is a sorted
horizontal bar. A part of one whole with five or six parts (today's absentees by reason,
the FormSG type split, each company's share of SFT) is a donut with every slice labelled. A
count across two dimensions (company by platoon, reason by period, weekday by hour) is a
heatmap on one sequential ramp. Company colours are identities and never reused for anything
else. Every chart has a Table view.

**Every chart states its coverage.** In the observed data only 5 of 45 parade days carry
all six companies, and the two sources cover different spans — parade state from
2026-07-11, FormSG from 2026-05-07 — so "all time" means different things on adjacent
cards. Each panel prints its own coverage as a fraction with both parts, and the Filing &
Accuracy page collects them all in one place.

**A platoon is the sub-header a line sits under.** `frontend/src/model/platoon.js` keeps the
sub-header only when the soldier's company has that sub-unit (`COMPANY_SUBUNITS`: Cougar has
`8`, Hercules `SIG`); anything else is Unassigned. The 4D number also encodes a platoon, and
that reading is supported but switched off (`USE_FOURD_PLATOON`) until the 4D scheme is
confirmed. Filing & Accuracy counts how often the 4D disagrees with the sub-header, which is
the check to run before switching it on.

## How it reads the data

The data **stays private**. Nothing is published, and no battalion data is committed to
this repo or passes through the deploy workflow.

The page asks one Vercel Function on the same deployment for everything it charts:

```
browser  --POST password-->  /api/session  --Set-Cookie: session (HttpOnly, 12h)-->  browser
browser  --GET, session cookie-->  /api/dashboard  --SELECT as dashboard_read-->  Neon
```

The password is checked **there**, in [`backend/api/session.ts`](../backend/api/session.ts), against
`DASHBOARD_PASSWORD` before any session is issued, and
[`backend/api/dashboard.ts`](../backend/api/dashboard.ts) checks the session before a single row is read.
A wrong password gets a 401, no cookie and no data.
A password checked in the browser instead would be decoration: the page's JavaScript is
public, so anyone could read past the check.

The route connects as `dashboard_read` ([`backend/db/grants-dashboard.sql`](../backend/db/grants-dashboard.sql)),
a role that can only `SELECT` the tables the dashboard charts and cannot read
`raw_messages.body` at all. [`backend/lib/dashboard.ts`](../backend/lib/dashboard.ts) answers with the tabs the
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
bun --env-file=.env.local backend/scripts/apply-grants.ts backend/db/grants-dashboard.sql
```

It writes `dashboard_read`'s connection string to `.env.dashboard_read` (gitignored); copy
it, then delete the file. Re-running rotates its password.

**3. Set both on Vercel** (Project Settings → Environment Variables), then redeploy:
`DASHBOARD_PASSWORD` (the passphrase), `SESSION_SECRET` (random, e.g. `openssl rand -hex 32`)
and `DASHBOARD_DATABASE_URL` (the written string).
The route fails closed: until both exist it answers 503 to everyone, including an empty
password.

**4. Holidays and rotations.** Holidays and rotations are edited under Settings → Calendar
by someone holding the settings password (`SETTINGS_PASSWORD`), not by SQL. Until they are
set, the Settings page says so, no holiday lines are drawn on any chart, and there is no
rotational grouping. Everything else works without them. The Unit, Thresholds and Session
sections are also edited there: the Basic tab holds Unit, Calendar and Thresholds (what a
new batch or battalion sets up); the Advanced tab holds Session (how long a login lasts and
how often an open dashboard re-reads).

**Then share the password with the CO, S1 and S3.** Not by anything that keeps a searchable
copy forever if you can help it.

### Rotating it

Change `DASHBOARD_PASSWORD` on Vercel and redeploy. Every open session was signed with the
old password, so all of them stop verifying at once: each dashboard is refused on its next
background refresh, within a minute, and asks for the new password.

## Running it locally

```
bun install
bun run dev:api                  # API on :3001 over synthetic data on the Neon test branch
bun run dev                      # the page on :5173, proxying /api to :3001
bun test                         # from the repo root
```

Log in with the passwords in `test/support/app.ts`. See `docs/DeveloperGuide.md`.

### Why there is a build step now

There did not used to be one, and losing that was a real cost. It is here because eight
pages of legend toggles, granularity radios, a fuzzy combobox and a live light/dark switch
are more state than an imperative DOM layer carries without turning into a hand-rolled
framework — and because the chart palette is read from CSS custom properties, which a
runtime theme switch has to be able to re-read. What it bought back: ECharts arrives as an
npm dependency and is tree-shaken to the series actually used, instead of a 1 MB CDN file
pinned by a hash that had to be recomputed on every version bump.

## Deploying

Vercel builds from GitHub with the project's Root Directory set to `backend`.
`backend/vercel.json` installs from the repo root, runs Vite in `frontend/` with its output in
`backend/public`, and sets the security headers. Pushing a branch gives a preview deployment;
merging to `main` deploys production.

`frontend/vite.config.js` sets no `base`: Vercel serves from the domain root, so the default
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

The server half is [`backend/api/dashboard.ts`](../backend/api/dashboard.ts), which reads through
[`backend/lib/dashboard.ts`](../backend/lib/dashboard.ts).

Browser tests are in [`test/frontend/`](../test/frontend); the read route's are
[`test/backend/api/dashboard.test.ts`](../test/backend/api/dashboard.test.ts) and
[`test/backend/lib/dashboard.test.ts`](../test/backend/lib/dashboard.test.ts).

## Three things worth knowing before reading the numbers

**`Att C` is MC.** Attend C means excused all duties, which in national service normally
means resting at home on a medical certificate. MC is therefore a category match, never a
text search — a text search would miss `Att C` rows written `HL` or `FEVER`, and would
wrongly count the `AFMC` rows (Air Force Medical Centre appointments, filed under
`Others`). Both directions are pinned by tests.

**Status is not absence.** `Status` is Attend B / light duty: present, excused specific
activities. It has its own tile and is never folded into an absentee count.

**The Status page counts what was in force; MC / MA and Report Sick count what began.** On the
Status page the tiles, heatmap, leaderboard and rankings take every Status episode listed on at
least one parade in the range, so a status begun weeks earlier still counts on the days it is
listed, and a single day's range matches that day's trend point. The other medical pages keep
the episodes whose start date falls in the range.

**Today's MC / MA tile, and the MC / MA trend, count who is out on the day.** Every soldier listed as
MC (including one whose MC began earlier and is still listed) or MA on that parade date counts,
once: a soldier with both an MC and an MA that day is one person (`distinctDutyOn`).

**Duration is reported, never derived.** Some messages state a day count that contradicts
their own date range. The dashboard shows the stated figure, records which source each
duration came from, and flags the disagreement — it does not quietly pick a winner. See
`ParserRows`' header for why deriving the count would be wrong exactly where it fires.

## Looking ahead

Today's **Ahead** section is the one forward-looking view. **Known Away, Next 14 Days** counts,
for each coming day, the soldiers on this parade's MC or leave whose stated end date has not
passed: a floor, since new MCs and absences with no end date are not in it. **Returning to Duty**
lists the soldiers on MC or leave on the selected parade with the day each is expected back, soonest
first. A soldier is back the day after his stated end date, and `From` is the earliest stated
start, which is later than the parade date for an absence booked ahead. Only MC (`Att C`) and
`Off/Leave` are listed. MA is a timed appointment later the same day, so the soldier is on
parade; counting MA and Others put 51 soldiers off parade on 22 Sep 26 against the 28 the
strength figures reported, while MC and leave gave 23. A soldier listed twice is one row, back
only when both absences end, and an absence with no end date reads `Not stated` rather than a
guessed day. The rules are in `frontend/src/model/projection.js`.

**Presence by Rank** splits the day's presence into officers, WOSpecs and enlistees from the
strength block's own split, so a company at 90% missing half its officers shows it.

## What is deliberately not here

- **No NRIC.** Neon has no NRIC column, and `SingPass Validated NRIC` and `Masked NRIC` are
  never requested.
- **No writes from the charts.** `/api/dashboard` connects as a role that can only read. The
  one page that writes, Deposit, writes through `/api/parade` and `/api/sft` (see below).
- **No stored password.** The password is sent once, to `/api/session`, and what comes
  back is a signed, 12-hour session token in an `HttpOnly`, `Secure`, `SameSite=Strict`
  cookie. Nothing in the page can read it — not injected script, not the person at the
  keyboard — and the password itself is never written to `localStorage`, `sessionStorage`
  or a cookie. A refresh therefore does not ask again, while the standing risk is only
  that an unlocked browser can open the dashboard until the session expires. **Lock**
  ends it at the server, and rotating `DASHBOARD_PASSWORD` or `SESSION_SECRET` ends every
  open session, because the token is signed with a key derived from both.
- **No per-viewer identity.** The token names nobody: there are still no accounts, no
  record of who looked, and no way to revoke one viewer.
  While open, the page re-reads `/api/dashboard` every minute the tab is visible and as
  soon as a hidden tab is shown again, swapping the data in without leaving the page. That
  read is also where an ended session is noticed: the login screen returns.
- **The Sankey's outcome is FormSG's; blank means no outcome.** The Report-Sick Flow's outcome
  and Status columns read each submission's own `report_sick_formsg.outcome` and `status_1…5`,
  never the parade state's Att C / Status episodes. A blank outcome is read as no outcome and
  joins `Outcome: No MC or Status` (decided 2026-10-08). `mc_days` and the status days are not
  charted (MC length comes from the parade-state episodes), and `genuine` is never charted,
  for the reason below.
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
  leaderboard so they all cover one named span; it defaults to All. The Today page and
  the masthead describe a single parade and ignore the range, and the parade-date
  selector's options narrow to the dates inside it — so a "today" figure never sits
  under a span the reader has to remember.

## Deposit

`frontend/src/pages/Deposit.jsx`, at `#/deposit`. A **Parade State / SFT** toggle in the header
picks the panel (`frontend/src/pages/deposit/`); it opens on Parade State.

### Parade State

`ParadePanel.jsx`. A clerk pastes a parade state WhatsApp
missed and presses Deposit; below it, every stored message (WhatsApp or manual) is listed
newest first with its key, status, source and receipt time, and can be edited or deleted.

- **Where it writes.** `/api/parade` on the same Vercel deployment (`frontend/src/data/parade.js`), with
  the session cookie from `/api/session`. A cookie-authorised write must be same-origin, so
  a forged cross-site form cannot deposit or delete.
- **Statuses.** Parsed (rows exist), Needs review (the parser doubted some lines; the list
  says how many, and Edit shows which, since the reasons quote personnel lines), Rejected (a last parade state, or not a parade state), Pending
  (stored, never parsed). Rules in `frontend/src/model/paradeMessages.js`.
- **Edit** loads the stored text into the form. Saving re-parses it; if it parses, the text
  and every row derived from it are replaced together, and if not, nothing changes and the
  reasons are shown. **Delete** asks once more inline, then removes the message and its rows.
- **Charts.** They read the same tables, so a deposit reaches them on the next refresh.
### SFT

`SftPanel.jsx`, over `/api/sft` (`frontend/src/data/sft.js`). FormSG is the only way an SFT record is
created, so nothing is deposited here: every stored record is listed (newest first, sortable,
with a filter on name, company, Group IC or location), and each can be edited or deleted.

- **Edit** loads the record into a form. Every answer can be corrected: rank, name, company,
  Group IC, PES status, exercises, SFABT type, location, the submission date and time
  (Singapore), and both acknowledgements. The server re-derives the name key, `unit_coy` (the
  soldier's own answer is kept when it already names the chosen company) and the SFT date,
  as it does when FormSG inserts the record. The page and the server check the correction
  with the same rules (`shared/sftEdit.js`): a name is required, the company must be a
  known one or blank, and the time may not be in the future. An NRIC-shaped value is refused.
- **Delete** asks once more inline, then removes the record.
- **Charts.** The SFT page reads the same table, so a correction reaches it on the refresh
  the panel triggers.

### Both panels

- **Local development.** Run `bun run dev:api` beside `bun run dev`; both panels then work
  against synthetic data.

## SFT

`frontend/src/pages/Sft.jsx`, at `#/sft`, over the SFT FormSG form (`sft_formsg`, written by
`backend/api/sft.ts`). Numbers come from `frontend/src/model/sft.js`.

- **Tiles.** Soldiers who did SFT in the range (unique by normalised name — the form has no
  4D), sessions in the range, soldiers who did SFT today (ignores the range), and the average
  group size.
- **By company.** Soldiers per company as a bar, and a table of soldiers, sessions, groups and
  average group size per company. A `Company` answer naming no known company is kept under
  All and dropped for a specific company, as for report sick.
- **Group size.** A group is everyone naming the same Group IC on one day, and its size counts
  the IC too (once, if the IC also filed). IC names are typed by hand, so they are
  consolidated first: ranks and punctuation are stripped and word order ignored
  (`shared/identity.js#namesMatch`), then each word is compared with `fuse.js`, so a one-letter
  slip ("LIM"/"LIMM") merges while a different given name ("MING"/"LIANG") does not. A
  session with no IC belongs to no group. A group's company is its members' most common one.
- **Locations and exercises.** Ranked by sessions; case and spacing variants merge, and a
  session doing three exercises counts once for each. Exercise spellings fold into one label
  (Run, Running, ER, Endurance run, Jogging are `Run`; Gym, Weights, Strength are
  `Gym / Weights`) by a short list in `model/sft.js#topExercises`.

## Figures and why they exist

Added 2026-10-08 after reading the real data, which showed: other duties were most of the
absences and never broken down; about a quarter of the battalion held a Status; fever and stomach
cases bunched in single platoons; one company's parade state arrived three hours after the
others. Each figure below is one pure model function (tested in `test/frontend/`) drawn with an
existing chart, except one new chart type (`Scatter`). Every one is a count, never a rate.

| Figure (page) | Question, and who asks it | Source | Why this chart | Caveats |
|---|---|---|---|---|
| **Other Duties, by Duty** (Today) | What are the soldiers under "Others" actually doing? (CO, S1) | `metrics.js#otherDutiesOn`: the reason text before any bracket, distinct soldiers | Sorted bar: a ranking of named duties. The absence donut keeps its four parts; splitting Others inside it would pass six slices | Free text: `COURSE` and `COURSES` are two bars until clerks write them alike |
| **Restrictions in Force** (Today) | Who cannot do tomorrow's training, by company? (OC, S3) | `statusBuckets.js#restrictionsOn`: Status lines on the parade, folded by `bucketsFor`; `Other` left out | Heatmap restriction × company: two dimensions of counts; names in the tooltip | One soldier with two restrictions counts under each |
| **Known Away, Next 14 Days** (Today) | How many will I be missing on the exercise next week? (S1, OC) | `projection.js#awayAhead`, from `returnsToDuty` | Line over coming days, weekends banded: a quantity over time | A floor: only MC and leave with a stated end date |
| **Outbreak Watch** (Report Sick) | Is an illness spreading in a platoon? (MO, OC) | `symptoms.js#infectiousByPlatoon`: new report-sick, MC, MA or Status lines whose reason names fever, flu, cough, cold, a stomach bug or conjunctivitis, by platoon sub-header, last 14 days of the range | Heatmap platoon × day, with clusters (3 cases in 3 days) named in the note: where and when at once | A word list over free text; a line that says only "MC" is not counted |
| **When MCs Start** (MC / MA) | Do MCs bunch next to weekends and holidays? (CO, RSM) | `episodes.js#startsByWeekday`: MC (Att C) episodes starting in range | Column per weekday in calendar order (not ranked: the order is the point); the note compares Monday, Friday and holiday-adjacent starts with the 2 in 7 expected by chance | Needs the holidays set under Settings → Calendar |
| **MC Pattern, by Soldier** (MC / MA) | Who needs a welfare conversation, and who an injury plan? (OC, MO) | `leaderboards.js#soldierLoad`: MCs and days lost per soldier; days held by the top 10 | Scatter: two measures per soldier separate many-short from few-long, which a ranking of either alone hides | Describes what was recorded, not why; see "No inference about intent" |
| **MC Length, by Symptom** (MC / MA) | Which conditions keep soldiers away longest? (MO) | `symptoms.js#lengthBySymptom`: episode `daysLost` in bands 1, 2–3, 4–7, 8+ days, by symptom from the reason | Heatmap symptom × band: a distribution per category without a box plot | Duration as stated, else dated, else observed (`episodes.js`) |
| **SFT While Restricted** (Status & Restrictions) | Is anyone training against their status? (S3, MO) | `sft.js#sftAgainstStatus`: SFT sessions on a day the soldier held Light Duty or an RMJ, heavy-load, upper-limb or kneeling excuse | A table: each line is a case to check, not a quantity | Names matched loosely (`namesMatch`); some sessions may be allowed |
| **Duty Load** and **On Duty While Away** (Duty Roster) | Is duty spread fairly? Was anyone rostered while away? (RSM) | `dutyRoster.js#rosterLoad`, `#rosterClashes` | Tables: names with counts, and cases to check | A battalion CDO on five rosters is one duty; clashes need names to match loosely and stated ranks to agree |
| **First Parade State, Minutes Late** (Filing & Accuracy) | Do companies file on time? (RSM, S1) | `submissions.js#filingTimes`: the first FPS filing per company per day, minutes past 08:00 | Heatmap company × day: a habit shows as a row, a bad day as a column | The 08:00 cut-off is a constant (`FILING_CUTOFF_MINUTES`); next-day filings are counted in the note, not drawn |
| **Sections That Do Not Add Up** (Filing & Accuracy) | Does each section header's count match the names under it? (S1) | `quality.js#countMismatches` over the `Section Counts` tab (`section_counts`, granted to `dashboard_read` by migration 0008) | Heatmap company × day, mismatched sections in the tooltip | Compares per sub-header and section, as the parser stored them |

Considered and left out: a rotation-aligned report-sick curve and control bands on the trends
need about three months of history (it starts 14 Sep 26); FormSG `mc_days` would duplicate
the episode durations; `genuine` stays uncharted.
