# Architecture patterns

Canonical architecture reference for AI agents working in this repo. Read this before
codebase exploration, broad refactors, or architecture-impacting changes, and update it
whenever architecture or ownership boundaries change.

The Apps Script + Google Sheets implementation is retired and deleted; read it from git
history if you need it. Nothing reads the Sheet any more: its history was imported once in
September 2026 by a script since deleted. Submissions it imported carry `model = 'sheet'`.

## Layout

| Path | Runtime | Owns |
|---|---|---|
| `backend/db/` | Bun / Vercel | Drizzle schema (`schema.ts`), Neon connections (`index.ts`, one handle per connection-string variable), migrations, and `grants-dashboard.sql` (the read-only `dashboard_read` role). `settings` holds one JSONB row per Settings-page section. `backend/scripts/apply-migrations.ts` records each migration by the SHA-256 of its LF-normalised text, so a CRLF checkout hashes the same |
| `backend/lib/` | Bun / Vercel | Shared domain: `pipeline.ts` (record → parse → validate → replace, plus edit and delete), `parser/`, `formsg/` (`webhook.ts` the shared FormSG route, `sdk.ts`, `decrypt.ts`, one mapper per form: `map.ts` report sick, `sft.ts` SFT), `dashboard.ts` (the dashboard's read, shaped as the old Sheet tabs), `sft.ts` (list, correct and delete stored SFT records, for `backend/api/sft.ts`), `http.ts` (JSON helpers, constant-time bearer check), `session.ts` (the dashboard's signed session cookies, and `isDashboardCaller`, the check `backend/api/parade.ts` and `backend/api/sft.ts` both authorise the dashboard with), `settings.ts` (read, save and reset settings sections), `domain.ts` |
| `backend/api/reportsick.ts` | Vercel Function | FormSG report-sick webhook (`FORMSG_SECRET_KEY`, `FORMSG_POST_URI`): insert one flat row into `report_sick_formsg` (sheet column order, plus derived `company`, `report_sick_date` (SGT), `received_at`, `symptom_category`, `symptom_other_text`) |
| `backend/api/sft.ts` | Vercel Function | FormSG Self-Regulated Fitness Training webhook, a separate form with its own key (`FORMSG_SFT_SECRET_KEY`, `FORMSG_SFT_POST_URI`): POST inserts one row into `sft_formsg` (mapped by `backend/lib/formsg/sft.ts`, plus derived `company`, `sft_date` (SGT)). GET/PUT/DELETE list, correct and delete records for the Deposit page (`DASHBOARD_PASSWORD` session, same-origin writes; `backend/lib/sft.ts`). A correction is checked by `shared/sftEdit.js#validateSftEdit` (the page runs it too) and the NRIC-shape refusal, and re-derives `name_key`, `unit_coy`/`company` and `sft_date` as the insert does. FormSG is the only way a record is created |
| `backend/api/dashboard.ts` | Vercel Function | The dashboard's read: GET, a session cookie or bearer `DASHBOARD_PASSWORD`, connects as `dashboard_read` (`DASHBOARD_DATABASE_URL`) and answers every tab from `backend/lib/dashboard.ts#loadTabs` and the settings in force from `backend/lib/settings.ts#readSettings`, plus `canEdit` |
| `backend/api/settings.ts` | Vercel Function | Saves and resets one settings section: PUT/DELETE, the `settings_session` cookie (from `SETTINGS_PASSWORD`) and a same-origin request; validates with `shared/settings/validate.js` |
| `backend/api/session.ts` | Vercel Function | The dashboard's login: POST accepts `DASHBOARD_PASSWORD` (read) or `SETTINGS_PASSWORD` (read-write, which also sets `settings_session`); the session's length comes from the Session settings (`backend/lib/session.ts`); DELETE ends it. The only route a password is sent to |
| `backend/api/parade.ts` | Vercel Function | The parade-state intake: POST stores and parses one message (WhatsApp relay or dashboard deposit); GET/PUT/DELETE list, read, edit and delete stored messages for the dashboard (see below) |
| `runner/` | Long-running Bun process on the ops laptop, started from the repo root with `bun run runner` (env from the root `.env.whatsapp`), or in the background via `bun run runner:service install` (a SYSTEM scheduled task) | Baileys listener under `supervisor.js`. `ingest.js` relays each accepted message to `backend/api/parade.ts`; it holds no database credentials. Baileys' own warnings are logged without their payloads (`listener.js#baileysLogger`) |
| `frontend/src/`, `frontend/index.html` | Browser (Preact + Vite, deployed by Vercel) | The dashboard: reads through `backend/api/dashboard.ts`; the Deposit page writes parade states through `backend/api/parade.ts` and SFT corrections through `backend/api/sft.ts`. See `docs/dashboard.md` |
| `backend/scripts/` | Bun | `apply-migrations.ts`, `apply-grants.ts` (runs `backend/db/grants*.sql` without psql and writes the role's URL to `.env.<role>`, never the terminal) |
| `shared/` | Browser and server | Pure JavaScript both sides import: the vocabulary (`domain.js`), dates and Singapore time (`dates.js`), cell readers (`values.js`), name and 4D normalisation (`identity.js`), rotations, the SFT correction check (`sftEdit.js`), the settings model (`settings/`) and the column headers the dashboard asks for (`tabs.js`). Nothing here imports from `frontend/` or `backend/` |
| `test/` | Bun | Every suite, mirroring the tree: `frontend/`, `backend/`, `runner/`, `shared/`, plus `e2e/` and `support/`. `test/setup.ts` is preloaded (`bunfig.toml`) |

Bun workspaces (`frontend`, `backend`, `runner`) each own their dependencies; `bunfig.toml` sets the hoisted linker so the root test suite resolves all of them. Vercel's Root Directory is `backend/`: `backend/vercel.json` installs from the repo root and builds the frontend into `backend/public`, and also sets the security headers (CSP `script-src 'self'`, so `frontend/index.html` loads `public/theme.js` instead of an inline script).

## How parade states are parsed

Both intakes end at `backend/api/parade.ts`, which calls `backend/lib/pipeline.ts#ingestMessage`: store the
message idempotently on `wa_message_id`, parse it, and write its rows, all in one request.

```
WhatsApp group ─► runner/   (first-parade check) ─► POST /api/parade  (Bearer PARADE_INGEST_SECRET, WhatsApp id)
Deposit page ─────────────────────────────────────► POST /api/parade  (session cookie, id = manual:<sha256>)
                                                        │
                                  recordMessage ─► parseBody ─► writeSubmission (one db.batch)
```

Parsing is `backend/lib/parser/deterministic.ts` first: a rule-based reader of the standard template
(`parade-state-example/parade_state_template.txt`) that takes about a millisecond. It returns
`problems`, one for every line or header it cannot read with certainty (an unknown duty word
outside OTHERS, unreadable dates, a line outside any section, a missing company or date); the
rules never store a guess. Any problem at all hands the whole message to the model fallback,
`OpenAiParser` in `backend/lib/parser/llm.ts` (prompt in `prompt.ts`, Structured Outputs schema in
`schema.ts`): `gpt-6-luna` (`OPENAI_MODEL` overrides) on the standard service tier, not flex,
because the call runs inside the intake request. `backend/api/parade.ts` builds it from `OPENAI_API_KEY`
and gets `maxDuration: 300` in `backend/vercel.json`; the relay waits as long. The model's extraction goes
through the same `validate`, and `parade_submissions.model` records which parser wrote the rows
(`deterministic` or the model id). With no key configured, or when the model call fails, no rows
are written: the message is stored with `error = 'Needs review: …'`, the intake answers 422 with
the problems, and a person corrects the text on the Deposit page. A filing habit that
keeps reaching the model is worth teaching the rules, with a synthetic case in
`test/backend/lib/parser-deterministic.test.ts`.

A resend of a message that already parsed is left alone (`already_parsed`), so it cannot
replace a newer parade state with an older one; a message that failed is parsed again, which is
free. An edit (`editMessage`) parses the new text first and writes nothing if it does not
parse; otherwise it replaces the text and the rows in one batch, removing the submission under
the old key when the company, date or session changed. A delete removes the message and its
submission (the child rows cascade).

The relay retries a network failure or 5xx three times and treats 200 and 422 as final; a
message it still cannot deliver is logged for a clerk to deposit by hand.

## Rules that hold everywhere

- **One write path per stream.** Parade-state rows are written only by `backend/lib/pipeline.ts`
  (called from `backend/api/parade.ts`); report-sick rows only by `backend/api/reportsick.ts`; SFT rows only
  by `backend/api/sft.ts` (the webhook's insert, and the Deposit page's corrections and deletes through
  `backend/lib/sft.ts`). Both FormSG routes are thin: verify → decrypt → map → NRIC-shape refusal →
  insert is `backend/lib/formsg/webhook.ts#handleWebhook`, and each route supplies only its table,
  mapper and env vars. Callers never re-implement any of these.
- **One write path for settings.** `settings` rows are written only by `backend/api/settings.ts`.
  Shared settings code (`shared/settings/`) is pure JavaScript used by both the browser
  and the server; the server passes settings as values and never uses `active.js`.
- **Idempotency lives in the database.** Unique constraints (`wa_message_id`, FormSG
  submission id) settle duplicate deliveries in one statement; there are no app-level locks.
- **`neon-http` has no interactive transactions.** Atomic writes go through `db.batch([...])`,
  so no statement may depend on an earlier `RETURNING`; that is why `parade_response_id` is a
  computable natural key.
- **NRICs never reach the dashboard; message bodies reach only the Deposit editor.**
  FormSG NRIC answers resolve to `discard` in `backend/lib/formsg/fields.ts` and have no column in
  `report_sick_formsg` or `sft_formsg`; the NRIC-shape refusal in `backend/lib/formsg/webhook.ts` guards both. `raw_messages.body` leaves the database only through
  `GET /api/parade?id=`, one message at a time, to a caller holding the dashboard password, so
  a clerk can correct it, together with `raw_messages.error` (the parser's reasons, which quote
  the doubted lines). The list carries only an outcome and a count of doubted lines, and no
  chart carries either. Nothing logs a body, a parser problem or a rejection reason, since all
  three can quote a personnel line: `backend/lib/http.ts#serverError` logs only error names and
  driver codes (a Drizzle error's message holds the query's params), and the FormSG routes log
  column names, never answers. Text sent to the model provider has NRIC shapes masked and
  `store: false` set (`backend/lib/parser/llm.ts`).
  The dashboard's read connects as `dashboard_read`, which cannot select `body`, and
  `backend/lib/dashboard.ts` builds every tab from the header arrays in `shared/tabs.js`, so a column
  leaves the database only if the dashboard asks for it; `test/frontend/schema.test.js` and
  `test/backend/lib/dashboard.test.ts` guard that no NRIC or body header is asked for.
- **Read what the message says; derive nothing.** The parser records only stated values; the
  one sanctioned exception is the permanent-status `num_days` sentinel. See `backend/lib/parser/rows.ts`.
- **Fail closed on missing configuration.** A route with an unset secret refuses every request
  that secret would authorise. `backend/api/parade.ts` checks bearer tokens in constant time; it has no
  lockout, so `DASHBOARD_PASSWORD` and `PARADE_INGEST_SECRET` must be long.
- **The browser holds a session, never a password.** `backend/api/session.ts` exchanges
  `DASHBOARD_PASSWORD` for a read session cookie, or `SETTINGS_PASSWORD` for a read session
  plus a `settings_session` cookie, each signed with a key derived from the password and the
  server-only `SESSION_SECRET` (so a stolen cookie cannot be brute-forced back into the
  password), and carried
  `HttpOnly`, `Secure`, `SameSite=Strict`: page script cannot read either, and rotating a
  password (or `SESSION_SECRET`) ends every open session because the old signatures stop
  verifying; with `SESSION_SECRET` unset nobody can log in. There is no
  session store — each cookie carries its own expiry, which is what makes it work on
  `neon-http`. A cookie-authorised write must also be same-origin (`Sec-Fetch-Site`, else
  `Origin` against `Host`), so a forged cross-site form cannot deposit, delete or save
  settings. `SETTINGS_PASSWORD` left unset, or equal to `DASHBOARD_PASSWORD`, fails closed:
  nobody can edit settings. The relay is not a browser and still uses its bearer token.

## Dashboard (`frontend/src/`)

Layers, dependency direction strictly downward:

| Layer | Holds | May import |
|---|---|---|
| `pages/` | one file per page; `pages/shared/` for the three category pages; `pages/deposit/` for the Deposit page's Parade State and SFT panels | everything below |
| `components/`, `charts/` | reusable panels, ECharts wrappers | `model/`, `theme/` |
| `app/` | shell, router, signals (`state.js`), session lifecycle and the background refresh (`auth.js`), Vercel Web Analytics and Speed Insights (`telemetry.js`: one page view per hash route, each URL rewritten to the route path so nothing but a page name is sent) | `data/`, `theme/` |
| `data/` | the `/api/dashboard` fetch and the headers asked of each tab (`feed.js`, `tabs.js`); the Deposit page's `/api/parade` and `/api/sft` calls (`parade.js`, `sft.js`), both through `api.js#callJson`, carrying the session cookie | `model/` |
| `model/` | every number and rule; pure functions, no DOM, no network | other `model/` files |

`model/` is the only layer under test and the only place a wrong number can come from. Every
colour is a token in `frontend/src/theme/tokens.css` (both themes), read by `frontend/src/charts/theme.js` at
paint time. `docs/DESIGN.md` is the visual reference.

`model/settings/` holds the settings model: `defaults.js` (each section's default value and the
set of section names), `validate.js` (per-section validation, run both in the Settings page's
form and again in `backend/api/settings.ts` before a save), `resolve.js` (merges a stored section over
its default, and is what `backend/lib/settings.ts#readSettings` uses on the server), and `active.js`
(the settings in force for the currently loaded dashboard, which `frontend/src/data/feed.js` sets from
each `/api/dashboard` reply and `frontend/src/data/settings.js#unitSettings`/`refreshMs` read).

Every parse, successful or not, records its parser (`deterministic` or the model id) and
duration on `raw_messages.parser` / `parse_ms`; `backend/api/parade.ts` also returns them in a
`Server-Timing` header and logs one line of parser, milliseconds and status. To see where the
time goes:

```sql
select parser, count(*), percentile_cont(0.5) within group (order by parse_ms) as median_ms, max(parse_ms)
from raw_messages where parser is not null group by parser;
```

## Testing

`bun test` from the repo root (`./test/`, preloading `test/setup.ts`). Running the DB suites empties the
test branch. `bun run dev:api` (`test/support/devServer.ts`) refills it with four weeks of synthetic data and
serves every route on port 3001, which `bun run dev` proxies to, so the dashboard runs locally with no
production access.
`bun run test:coverage` writes `coverage/lcov.info` (settings in `bunfig.toml`); `.github/workflows/ci.yml`
runs it on every push and pull request to `main` and uploads it to Codecov (`CODECOV_TOKEN`;
the DB suites run there only when the `TEST_DATABASE_URL` secret is set; one run at a time, since they share that branch).

- **Pure suites always run**, offline: the parser, FormSG mapping (with the real SDK in its
  `test` mode), the dashboard model, the bridge's helpers, and every refusal a route makes
  before it touches the store (asserted against a store that throws if touched).
- **DB and end-to-end suites** run against a Neon test branch named by `TEST_DATABASE_URL`
  (see `.env.example`) through the app's own `neon-http` driver, and are skipped when it is
  unset. `test/support/db.ts` migrates the branch, empties every table before each test, and
  refuses a URL on the same endpoint as any app database. `test/e2e/` serves the three routes on
  a local port and drives them with the bridge's handler, the dashboard's `frontend/src/data/` calls and
  real signed FormSG webhooks, then checks what `frontend/src/model/` computes.
- **Only the OpenAI call is faked** (`ModelParser`), because it is a paid external API.
- Tests are data-driven over dummy data: `test/support/paradeState.ts` renders a parade state
  from a spec in the standard template, `scenarios.ts` holds named and seeded random specs, and
  expectations are counted off the spec rather than the implementation. Names are synthetic.
