# Architecture patterns

Canonical architecture reference for AI agents working in this repo. Read this before
codebase exploration, broad refactors, or architecture-impacting changes, and update
it whenever architecture or ownership boundaries change.

Depth lives elsewhere: [DeveloperGuide.md](../DeveloperGuide.md) explains *why* each
decision was made, [README.md](../README.md) is the operator runbook. This file is the
map.

## Two independent intakes

The repo holds two pipelines. They stay independent: no intake module imports another,
and a change to one cannot break another.

| Pipeline | Entry point | Lands in |
|---|---|---|
| Parade state (AI) | `whatsapp/src/index.js` — long-running Bun process on the ops laptop; parses via `lib/pipeline.ts` | `raw_messages` → `parade_submissions`, `strength_rows`, `personnel_rows`, `command_roster_rows`, `section_counts` |
| Report sick (FormSG) | `api/formsg.ts` — Vercel Function, FormSG webhook | `formsg_submissions`, `formsg_statuses` |

The WhatsApp relay runs under an in-repo Bun supervisor (`whatsapp/src/supervisor.js`,
which is what `bun start` runs): it spawns `whatsapp/src/index.js`, forwards its output,
and restarts it on up to 3 consecutive crashes before exiting non-zero for an OS-level
relauncher. No new dependency — `Bun.spawn` only. Inside that process the listener holds
**exactly one** Baileys socket at a time and exits non-zero (for the supervisor to
recycle) rather than stacking sockets on a flaky link, which would corrupt the persisted
libsignal session under `whatsapp/auth/`.

One route reads rather than writes: `src/dashboard/DashboardFeed.js` serves the three
parade-state tabs and the FormSG tab back out to `dashboard/`. See *The dashboard is a
read-only consumer*.

**One `doPost`, routed explicitly.** Apps Script allows a single `doPost` per project,
and three callers need it. `src/WebApp.js` owns the global and dispatches on a `route`
query parameter — `?route=reportsick` to FormSG, `?route=paradestate` to the parade
state pipeline, `?route=dashboard` to the read-only feed. An unrouted or unknown
request is **rejected**, never defaulted: `ContentService` cannot set a status code, so
a body accepted by the wrong handler would write wrong rows to the wrong tab and still
answer 200.

`WebApp.js` is therefore the one file that knows all three exist. That is the whole of
the coupling, and it is deliberately confined to a file with no logic of its own.

## How the parade-state pipeline runs

The WhatsApp runner (`whatsapp/src/index.js`) is the only way in. It stores every
accepted message through `recordMessage`, then drains the backlog through `parseDue`
— both in `lib/pipeline.ts`. A drain runs once at start-up, again on every
`PARSE_INTERVAL_MS` tick, and after every message the handler stores — so a new parade
state is parsed as soon as it arrives, not just swept up on the interval. A drain is
single-flight: a call made while one is already
running does not start a second, it just asks the running drain to go round once more
when it finishes, so two `parseDue` runs never select the same row and pay twice for
the same extraction. Parsing runs here rather than on Vercel because one extraction
takes 74–126 seconds — past the Hobby plan's 60-second function cap — and Hobby also
refuses the sub-daily cron that would otherwise have swept a queue. A long-running
process on the ops laptop has neither limit. The runner connects to Neon as the
`parade_ingest` role (`db/grants-ingest.sql`), which can store raw messages and write
parsed rows and nothing else — no FormSG or dashboard access.

`api/whatsapp.ts` and `api/parse-due.ts` — the Vercel webhook and cron drain this
replaced — are retired but still exist and are still deployed; they are removed only
after the local runner is verified live.

## The row is the state

The parade-state pipeline keeps **no** status ledger, no retry budget, and no error
tab. One column carries every outcome:

| `parade_response_id` | Meaning |
|---|---|
| empty | Due for processing |
| empty, `error` = `Processing...` | A run started and did not finish; still due |
| `Archer_2026-06-22_FPS` | Processed; output rows exist under that key |
| `ERROR` | Failed; the reason is in the `error` column on the same row |

`processRow` stamps `Processing...` into `error` before extraction; every completed run
overwrites `error` again, so that marker survives only a killed run and the row stays
due. Clearing the cell by hand is the manual reprocess gesture; the
`reprocessPendingRows` menu macro is the capped batch equivalent for every still-blank
row at once (it does not retry `ERROR` rows). An AI failure and a validation
failure are the same outcome, because the operator's next move is the same either way —
which is why there is no separate "needs review" state and no `logRef` placeholder for
an error written somewhere other than the row that caused it. A script write does not
fire `onEdit`, so writing the id back does not loop.

Two consequences worth knowing before changing anything here, both learned the hard way:

- **`onEdit` passes the cleared id through** as `previousId`. A corrected message can
  process to a *different* key, and without this the old key's output rows are orphaned
  in all three tabs with nothing pointing at them. Apps Script supplies `e.oldValue`
  only for a single-cell edit, which is exactly this gesture.
- **Deleting a duplicate response row shifts the current row's index.**
  `deleteDuplicateRawResponses_` returns how many rows above it removed, and the caller
  subtracts that before writing the outcome. Without it the key lands one row too low,
  onto whatever submission happens to be there. For the same reason `reprocessPendingRows`
  walks its due rows bottom-up, so a duplicate deleted during one row's run never shifts a
  row still to be visited.

## Runtimes

Two, and the boundary between them matters more than it looks.

**Google Apps Script** (`src/`) — V8, but not Node. No modules, no `import`/`require`,
no npm, no `TextDecoder`, no build step. Every file shares **one global lexical
scope**, which is how `FormSgSheet` reaches `FORMSG_COLUMNS` and `ParserSheets` reaches
`RAW_RESPONSES_COLUMNS` with no import. Class
static methods cannot be invoked by Apps Script directly, so each editor entry point
and trigger handler is a plain top-level `function` that delegates to one.

Deployed with `bunx clasp push`. `.clasp.json` sets `rootDir: "src"`, so **`src/` is
the deployment boundary** — anything under it ships, anything outside it does not.
That is why `test/` sits at the repo root.

**Bun** (`whatsapp/`, `test/`) — ESM, npm, `bun test`. Ordinary Node-shaped code.

**Browser** (`dashboard/`) — Preact and JSX, built by Vite. Its own `package.json` and
lockfile, separate from the repo root's, because it is the only part of the project with
runtime dependencies. `bun run dev` to work on it, `bun run build` to produce `dist/`.
Its tests still run from `test/dashboard/` under the root `bun test`, because the model
layer is pure and needs no browser.

## The dashboard is a read-only consumer

The dashboard (`index.html` and `src/`) is a Preact application built by Vite and
deployed by Vercel from the repository root, with its build settings pinned in
`vercel.json`; what is served is `dist/`, not the source as it sits. It is the spreadsheet's fourth party, and the only one that never writes to it.

**It used to have no build step, and losing that was a real cost.** The build is here
because seven pages of legend toggles, granularity radios, a fuzzy combobox and a live
light/dark switch are more state than an imperative DOM layer carries without turning into
a hand-rolled framework — and because the chart palette is read from CSS custom properties,
which a runtime theme switch has to be able to re-read. What the build bought back: ECharts
arrives as an npm dependency and is tree-shaken to the series actually used, instead of a
1 MB CDN file pinned by an SRI hash that has to be recomputed on every version bump.

It has a server half, and the split is the point. `dashboard/` cannot hold a credential —
it is a public page — so it holds none: `src/dashboard/DashboardFeed.js` is the third
route on the existing web app (`?route=dashboard`), it opens the sheet as the deployment's
owner, and it checks the `DASHBOARD_PASSWORD` script property before reading a row. The
browser half knows a URL and whatever the viewer typed; the decision about whether that is
enough is made where the viewer cannot reach it.

That is why the spreadsheet can stay private with no sharing list to maintain, and it is
the reason the alternative was rejected: a password checked in the page would need the
tabs published to be reachable at all, and a published tab is readable by URL whether the
check passes or not.

The boundary stays one-way and strict: **the dashboard reads the sheet and nothing else**.
`dashboard/` does not import from `src/`, is not deployed by clasp, and holds no secret;
`src/dashboard/` writes no cell and neither intake imports it. Deleting either half leaves
the three intakes untouched.

Two consequences of that direction:

- **Columns are resolved by header name at read time**, not by fixed index. `src/` owns
  the layout and refuses a sheet whose header does not match; a read-only consumer can
  afford to tolerate a column being added or reordered, but not to read `reason` out of
  the `location` column. `test/dashboard/schema.test.js` asserts every header the
  dashboard requires still exists in the canonical `*_COLUMNS` arrays, so an upstream
  rename fails a test instead of shipping a blank chart.
- **`dashboard/` is a deployment boundary**, exactly as `src/` is for clasp: what the
  build emits is published. So its tests live in `test/dashboard/`, and its fixtures
  (`test/dashboard/fixtures.js`) are built from the real `PERSONNEL_DATA_COLUMNS` /
  `STRENGTH_DATA_COLUMNS` arrays via `ParserRows`, so the rows under test cannot drift
  from the column order the parser writes.
- **One tab is read as a projection, not in full.** `Parade State Responses` answers when
  each company filed, which no output tab can. Its second column is the free text a duty
  commander typed, and observed messages carry NRICs, full names and diagnoses in one
  blob. So `DashboardFeed.readColumns_` returns `Timestamp` and `parade_response_id` and
  nothing else, on the Apps Script side, before the row is serialised — reading the tab
  whole and letting the browser ignore the body would still have sent it. Pinned in
  `test/dashboard.feed.test.js` by asserting the body reaches no part of the reply.
- **Two tabs have no upstream owner.** `Public Holidays` and `Rotations` are read by the
  dashboard and written by nobody: neither concept exists in `src/`, and an operator
  creates each tab by hand (`test/MANUAL_CHECKS.md` holds the headers). They are optional
  reads, so a battalion that has created neither still gets a working dashboard. There is
  nothing for `schema.test.js` to cross-check them against, and asserting a copy against
  itself would only look like coverage.

- **The three category pages are one renderer, not three.** MC, report sick and status
  ask the same four questions — trend, company, platoon, who most often — so
  `pages/shared/CategoryPage.jsx` answers them once and is parameterised per category.
  Three renderers would drift into three layouts panel by panel, and the whole value of
  the arrangement is that a commander learns it once and reads it three times.
- **Platoon is the one place the dashboard derives rather than reads.** `src/` holds the
  rule "read what the message says; derive nothing", and `model/platoon.js` is a
  deliberate read-side exception to it: the `platoon` cell is blank on 100% of Hercules
  rows, 96% of Cougar's and 39% of Braves', which leaves a platoon heatmap empty for half
  the battalion. The 4D's leading digit says which platoon a soldier is in, so a blank
  cell is filled from it. A stated platoon always wins, an inferred one is marked as
  inferred wherever it is drawn, and the inference rate is printed on the chart. The
  Report Sick page extends this to the FormSG source: its "Unit & Coy" answer names only a
  company, so the heatmap and the company/platoon rate tables take the submitter's platoon
  from their 4D through the same rule, and a submission with no usable 4D is placed under
  `HQ` rather than a separate unassigned bucket. `model/formsg.js` `submissionPlatoonOf`
  is the one entry point; the platoon table's coverage note says the value is inferred.
- **Chart colour is validated, not chosen, and it lives in one file.** Every colour the
  dashboard uses is declared in `src/theme/tokens.css` in both themes, and
  `src/charts/theme.js` reads those custom properties off the document at paint time — so
  a chart is tinted by the same values as the card it sits in, and an inline hex anywhere
  breaks that link silently. Forms where any two series are compared directly stay capped
  at three or four slots. The one deliberate widening is a six-slot ramp for the six
  companies, which a legend-toggled line chart genuinely needs; it is Okabe-Ito, chosen
  because six lines on one axis is exactly the case where colour-blind separability
  decides whether the chart works. Where a form needs more parts than its cap, the extra
  parts take the neutral ramp rather than an invented hue.
- **Every chart states its coverage.** Only 5 of 45 parade days in the observed data carry
  all six companies, and the two data sources cover different spans — parade state from
  2026-07-11, FormSG from 2026-05-07 — so "all time" means different things on adjacent
  cards. `model/quality.js` computes those fractions once and every panel prints its own,
  as a fraction with both parts rather than a bare percentage.
- **A composition chart is drawn only where the parts sum to the whole it names.** The
  strength donut earns that by construction — `strengthMix` gives every soldier exactly
  one of the sheet's categories, by a documented precedence, and makes `Full duty` the
  residual. Where two hand-written parts of the same message disagree, both figures reach
  the screen: the donut states the strength line's own present count beside its own.
- **A date crosses the boundary as text, in the spreadsheet's timezone.**
  `DashboardFeed.toJsonValue_` formats it; `JSON.stringify` would render a Date in UTC and
  slide every Singapore parade state back a day. That failure mode errors nowhere — the
  numbers simply land on the wrong date — so it is pinned at the boundary, in
  `test/dashboard.feed.test.js`.

### Inside `dashboard/src`

Five layers, and the dependency direction runs strictly downward through them:

| Layer | Holds | May import |
|---|---|---|
| `pages/` | one file per page; `pages/shared/` for what the three medical pages share | everything below |
| `components/`, `charts/` | the reusable panels, and the ECharts wrappers | `model/`, `theme/` |
| `app/` | shell, sidebar, router, the signals in `state.js`, the password's life in `auth.js` | `data/`, `theme/` |
| `data/` | the one `fetch`, and what the dashboard asks each tab for | `model/` |
| `model/` | every number and every rule. Pure functions, no DOM, no network | only other `model/` files |

`model/` is the layer that matters. It is the only one under test, it is the only one a
wrong number can come from, and it is the reason a page can be rewritten without
re-deriving a single metric. A page that computes something itself instead of asking
`model/` for it is the defect this table exists to prevent.

Data never leaves the viewer's browser: it goes from the feed to the page and no further.
There is no service account, no published CSV, no committed snapshot, and nothing
sensitive in the Pages artifact — which is why this consumer can be public while the data
behind it is not. What the shared password costs is identity: it authorises without
identifying, so there is no per-viewer revocation and no record of who looked. That was
chosen knowingly over Google sign-in, which offered both but required a Cloud project, a
consent screen and a test-user list to keep in sync.

## Ownership boundaries

`src/parser/ParserSchema.js` owns the parade-state schema; `src/formsg/FormSgColumns.js`
owns the FormSG schema. Neither reads the other. The duplication (two sheet-getters, two
column arrays) is deliberate: it is what lets either module be lifted out whole.

Within the parade-state pipeline the dependency direction is strictly one-way:
`Parser` → {`ParserSheets`, `ParserAi`, `ParserRows`} → `ParserSchema`. Nothing depends
on `Parser`.

There is no migration code and no one-time code anywhere in `src/`. Schema changes to a
live spreadsheet are applied by hand — see `test/MANUAL_CHECKS.md` — because a migration
that has already run everywhere is dead weight that still has to be read and understood
by whoever comes next.

## Recurring patterns

**Static-class-as-namespace.** Every service is an ES6 class with only static methods
and `_`-suffixed private helpers. There is no per-instance state anywhere.

**`src/` holds execution code only.** No setup functions, no diagnostics, no
`verifySetup`, no `listInstalledTriggers`. What such a function used to check now
happens on the path that needs it: script-owned tabs are created with their header row
on first write (`ParserSchema.sheet_`, mirroring `FormSgSchema.sheet`), a missing API
key throws from `ParserAi` onto the row, and a missing token fails closed. Anything that
only *verifies* lives in `test/`. There is deliberately no `setup()` to paste live
secrets into — script properties are set in the editor's Project Settings.

**Column arrays are the single source of truth.** `FORMSG_COLUMNS` and
`ParserSchema.js`'s arrays define sheet layout; header rows are derived from them, never
the reverse.

**A sheet with data under a wrong header is refused, never rewritten.**
`FormSgSchema.verify` will not relabel rows from a spec that may itself be wrong, and
`ParserSheets.readText` goes further for the Form-owned `Parade State Responses`: on a
header mismatch it logs the expected and actual header and writes **nothing at all**.
With a wrong header every column index is meaningless, so writing an error into what we
believe is the `error` column could overwrite real data. The log is the only safe
channel, and it doubles as the operator's instruction.

**Every mutating sheet write holds a `LockService` lock**, spanning read-then-write so
concurrent executions cannot both decide a row is new.

**Idempotency by stable id.** Both intakes dedupe on an id column before appending,
because both can receive the same payload twice — see DeveloperGuide.md §8.3 for the
Apps Script 302 behaviour that makes this mandatory rather than defensive. FormSG keys
on `Response ID`; the WhatsApp relay keys on `wa_message_id`, the Baileys message id.
Both hold the lock across the read-then-append. A redelivery no longer drops
unconditionally: if the matched row is still blank — a first delivery whose `processRow`
was killed mid-run — `handlePost` reprocesses it, so the resend is the recovery path; a
row already holding a key or `ERROR` is skipped as before.

**Permanent vs transient failure.** `ContentService` always answers 200 and no status
code can be set, so handlers signal by control flow instead: log and return 200 for
anything a retry cannot fix; **throw** for transient failures, since that is the only
way to make Apps Script emit a 5xx and get retried. Note that a failed *extraction* is
not an endpoint failure — it is recorded on the row, and the caller is told the relay
succeeded, because resending would only fail the same way.

**Read what the message says; derive nothing.** The prompt asks only for values present
in the text, and `ParserRows` computes none. This is not fastidiousness: the labelled
examples contain entries whose stated day-count disagrees with their own date range, and
overnight duties spanning two dates that count as one day, so a derived `num_days` would
be wrong precisely where it fired. `in_camp` is likewise never inferred from a location
name. The single sanctioned exception is a keyword-to-sentinel map: a permanent `Status`
entry (its `reason` says "Permanent"/"Perm") is forced to `num_days` `999`
(`PERM_STATUS_NUM_DAYS`) so downstream reads "no expiry" as one integer check. That is
not date arithmetic, so it does not cross the line above. See `ParserRows`' header for
the full argument.

## Testing

`bun test ./test/ ./whatsapp/test/` from the repo root runs everything, with no Google
account and no API key involved. `test/` covers the Apps Script side and, under
`test/dashboard/`, the dashboard's model layer; `whatsapp/test/` covers the bridge.

`test/harness.js` concatenates a source directory into one `node:vm` script —
reproducing Apps Script's single shared global scope — and stubs the Google globals. It
also shares the host realm's intrinsics into the context, so `value instanceof Date`
behaves as it does in Apps Script's single realm. Three loaders:

- **`loadFormSg()`** — `src/formsg/*.js` plus `src/WebApp.js`. The parade-state pipeline
  and the dashboard feed are recording stubs here, which is all that is needed to prove
  `WebApp.js` routes to them (`test/router.test.js`). Routing is worth testing precisely
  because a mistake there fails invisibly.
- **`loadParser()`** — `src/parser/*.js` with in-memory sheets. Only the network is
  faked: `ParserSheets`, `ParserRows` and `ParserSchema` all run for real, so a write to
  the wrong column shows up as a wrong cell rather than a passing mock. Tests replace
  `ParserAi.extract` per case, which works because Apps Script resolves these bindings
  through the shared global scope at call time.
- **`loadDashboard()`** — `src/dashboard/*.js` plus `src/WebApp.js`, the mirror image of
  `loadFormSg`: the real feed, with both intakes stubbed. Its `Utilities.formatDate` fake
  uses a fixed offset per zone and **throws on a zone it does not know**, rather than
  falling back to UTC — a fallback would turn a timezone bug in the code under test into
  a passing test.

The pattern to preserve: **the Apps Script sources need no test-only modification**.
No exports, no module wrapper, no bundler between the editor and the deployed script.

One thing in `test/` is not a `bun test` file:

- **`MANUAL_CHECKS.md`** is the post-deploy checklist for what cannot be automated.

Real parade-state messages were hand-labelled during design to tune the prompt and
validator. The governing rule when reading them is the prompt's own: **never record a
value the message does not state.** An audit against that rule removed 35 inferred
`in_camp` labels. Those labelled messages are kept outside the repo.

## Third-party boundaries

Decryption of FormSG submissions is **not** done in this repo. Plumber
(plumber.gov.sg) holds the form secret key, decrypts, and relays plaintext JSON to
`doPost`. Consequently `src/` contains no cryptography and no key material.

Every web-app route is gated by its own shared secret in the request body, checked
fail-closed against its own script property — `WHATSAPP_INGEST_TOKEN` for
`?route=paradestate`, `FORMSG_INGEST_TOKEN` for `?route=reportsick`,
`DASHBOARD_PASSWORD` for `?route=dashboard`. They are separate so any one route's
secret can be rotated alone. A shared secret is the ceiling of what is possible here:
Apps Script cannot read request headers, so an HMAC over the body — or verifying
FormSG's `X-FormSG-Signature` — is not an option. See DeveloperGuide.md §8.4.

The dashboard route is the one where a correct guess is worth something: the two ingest
secrets protect against junk rows and API spend, while it protects names and medical
reasons. So it alone counts failures and locks itself, and it alone is a password a
person types rather than a token a machine holds — which is why the guidance beside it
is about passphrase length. It remains a shared secret, so it authorises without
identifying: no per-viewer revocation, no record of who read what.

If you are tempted to add crypto (as opposed to a shared secret) to `src/`, read
DeveloperGuide.md §8.1 first: that is exactly what was removed, and why.
