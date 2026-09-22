# Battalion Personnel Dashboard

A dashboard over the spreadsheet the parade-state and FormSG pipelines write to.

## What it is for

Seven pages, in the order a commander reads them:

| Page | Answers |
|---|---|
| **Overview** | Who has filed a parade state this morning, and when? How many do I have, how many turned up, and why is the rest missing? |
| **Report sick** · **MC / MA** · **Status** | Is it getting worse? Which company? Which platoon? Who, most often? |
| **Soldier** | How often has this man been out, and how long was each episode? |
| **ORBAT** | Who is on duty today, from the CDO down? |
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

## How it reads the sheet

The spreadsheet **stays private**. Nothing is published to the web, no tab is shared by
link, and no battalion data is committed to this repo or passes through the deploy
workflow.

Instead the page asks the Apps Script web app this project already runs — the same `/exec`
URL that receives parade states and report-sick submissions, with a third route:

```
browser  --POST { password }-->  /exec?route=dashboard  --reads-->  private spreadsheet
```

The web app is deployed as *execute as me*, so it opens the sheet as its owner. The
password is checked **there**, in `src/dashboard/DashboardFeed.js`, before a single row is
read. That is the part that matters: a wrong password returns `unauthorised` and no data.

A password checked in the browser instead would be decoration. The page's JavaScript is
public, so anyone could read past the check — and the sheet would have to be published for
the data to be reachable at all, at which point the URL alone is enough for anybody.

**Anyone who knows the password can see everything.** There is no per-person identity, no
record of who looked, and no way to revoke one viewer: removing someone means changing the
password for everyone. That is the trade for having no accounts to manage. If you later
want per-person access instead, the sheet's own sharing list can do it — that is a
different design, not a setting.

## One-time setup

Two steps. No Google Cloud project, no OAuth consent screen, no test-user list.

**1. Set the password on the Apps Script side.**

Pick a long random passphrase — this is the only thing standing in front of the data, and
it is typed rarely and pasted into a chat once, so length costs you nothing:

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

In the Apps Script editor: **Project Settings → Script properties → Add script property**,
name `DASHBOARD_PASSWORD`, value the passphrase. Save.

The check fails closed, so until this property exists the route rejects every request —
including an empty password. There is no window where the dashboard is open.

**2. Point the dashboard at the web app.**

Redeploy the web app (**Deploy → Manage deployments → edit → Deploy**) so the new route
goes live; `clasp push` alone is not enough. Keep the same deployment so Plumber and the
WhatsApp bridge keep working — their URLs do not change.

Copy the `/exec` URL, append `?route=dashboard`, and put it in `FEED_URL` in
[`src/data/config.js`](src/data/config.js):

```js
export const FEED_URL = 'https://script.google.com/macros/s/AKfy…/exec?route=dashboard';
```

That URL is not a secret — the endpoint refuses to answer without the password — so it is
fine in a public repo. The password is never in this repo, in `config.js`, or in the page.

**3. Optionally, create the two settings tabs.**

`Public Holidays` (headers `date | name`) and `Rotations` (headers `name | start_date |
end_date`) are read by the dashboard and written by nothing. Create them by hand; until
you do, the dashboard reports them as missing on its Settings page, draws no holiday
lines, and offers no rotational grouping. Everything else works without them.

**Then share the password with the CO, S1 and S3.** Not by anything that keeps a searchable
copy forever if you can help it.

### Rotating it

Change the script property. Every open dashboard keeps working until its tab is reloaded,
and no redeploy is needed.

### If someone starts guessing

Ten wrong passwords in fifteen minutes and the route stops answering — including to the
right password, so the guessing cannot continue and you find out. It clears itself after
fifteen minutes. This is a speed bump, not a lock: the real defence is the length of the
passphrase.

## Running it locally

```
cd dashboard
bun install
bun run dev                      # then open the URL it prints
```

```
bun test ./test/                 # from the repo root: model layer, feed, and router
```

The feed is reachable from `localhost` without any extra configuration, because the Apps
Script web app is not origin-restricted — so `bun run dev` gives you the real data as soon
as you type the password.

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
  data/               config.js (feed URL) · feed.js (the one POST)
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

The server half is [`src/dashboard/DashboardFeed.js`](../src/dashboard/DashboardFeed.js),
routed from [`src/WebApp.js`](../src/WebApp.js).

Browser tests are in [`test/dashboard/`](../test/dashboard), outside this directory because
everything in `dashboard/` is published. The feed's tests are
[`test/dashboard.feed.test.js`](../test/dashboard.feed.test.js), alongside the other Apps
Script tests.

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

## What is deliberately not here

- **No NRIC.** `SingPass Validated NRIC` and `Masked NRIC` are never requested from the
  FormSG tab.
- **No writes.** The feed only reads; nothing the dashboard does can change the sheet, and
  a test asserts the read path leaves every cell untouched.
- **No stored password.** It is held in the page's memory for the life of the tab — not in
  `localStorage`, not in `sessionStorage`, not in a cookie — so a reload asks again and
  closing the tab ends the session.
- **No inference about intent.** The leaderboards rank by episode count and days lost.
  They report what was recorded and nothing else — a soldier managing a chronic condition
  and a soldier avoiding training appear the same way, and the difference is a
  conversation, not a number. A weighted score (Bradford Factor) was built and then
  removed: it needed a paragraph beside every table explaining what it must not be used
  for, which is a poor trade for a ranking two plain columns already give you.
- **No session filter.** Every parade state in the sheet is a first parade, so a control
  offering one option is furniture.
- **Date range, scoped to the aggregates only.** The range control (a two-click month
  grid, plus Last 7 days / Last 14 days / This month / All) bounds every trend, rate and
  leaderboard so they all cover one named span; it defaults to All. The Today view and
  the masthead describe a single parade and ignore the range, and the parade-date
  selector's options narrow to the dates inside it — so a "today" figure never sits
  under a span the reader has to remember.
