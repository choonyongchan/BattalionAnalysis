# Architecture patterns

Canonical architecture reference for AI agents working in this repo. Read this before
codebase exploration, broad refactors, or architecture-impacting changes, and update it
whenever architecture or ownership boundaries change.

The Apps Script + Google Sheets implementation is retired and deleted (`legacy/`, the
`node:vm` harness and its tests); read it from git history if you need it. Nothing reads
the Sheet any more: its history was imported once by `scripts/import-sheet.ts`.

## Layout

| Path | Runtime | Owns |
|---|---|---|
| `db/` | Bun / Vercel | Drizzle schema (`schema.ts`), Neon connections (`index.ts`, one handle per connection-string variable), migrations, and `grants-dashboard.sql` (the read-only `dashboard_read` role). `settings` holds one JSONB row per Settings-page section. `.gitattributes` pins `db/migrations/*.sql` bytes, because `scripts/apply-migrations.ts` records each file's SHA-256 and a line-ending change on checkout would make an applied migration look pending |
| `lib/` | Bun / Vercel | Shared domain: `pipeline.ts` (record → parse → validate → replace, plus edit and delete), `parser/`, `formsg/`, `dashboard.ts` (the dashboard's read, shaped as the old Sheet tabs), `http.ts` (JSON helpers, constant-time bearer check), `session.ts` (the dashboard's signed session cookies), `settings.ts` (read, save and reset settings sections), `domain.ts` |
| `api/formsg.ts` | Vercel Function | FormSG webhook: verify signature, decrypt, map, insert one flat row into `report_sick_formsg` (sheet column order, plus derived `company`, `report_sick_date` (SGT), `received_at`, `symptom_category`, `symptom_other_text`) |
| `api/dashboard.ts` | Vercel Function | The dashboard's read: GET, a session cookie or bearer `DASHBOARD_PASSWORD`, connects as `dashboard_read` (`DASHBOARD_DATABASE_URL`) and answers every tab from `lib/dashboard.ts#loadTabs` and the settings in force from `lib/settings.ts#readSettings`, plus `canEdit` |
| `api/settings.ts` | Vercel Function | Saves and resets one settings section: PUT/DELETE, the `settings_session` cookie (from `SETTINGS_PASSWORD`) and a same-origin request; validates with `src/model/settings/validate.js` |
| `api/session.ts` | Vercel Function | The dashboard's login: POST accepts `DASHBOARD_PASSWORD` (read) or `SETTINGS_PASSWORD` (read-write, which also sets `settings_session`); the session's length comes from the Session settings (`lib/session.ts`); DELETE ends it. The only route a password is sent to |
| `api/parade.ts` | Vercel Function | The parade-state intake: POST stores and parses one message (WhatsApp relay or dashboard deposit); GET/PUT/DELETE list, read, edit and delete stored messages for the dashboard (see below) |
| `whatsapp/` | Long-running Bun process on the ops laptop, started from the repo root with `bun run whatsapp` (root `package.json`, env from `.env.whatsapp`), or in the background via `bun run whatsapp:service install` (a SYSTEM scheduled task) | Baileys listener under `supervisor.js`. `ingest.js` relays each accepted message to `api/parade.ts`; it holds no database credentials |
| `src/`, `index.html` | Browser (Preact + Vite, deployed by Vercel) | The dashboard: reads through `api/dashboard.ts`; the Deposit page writes through `api/parade.ts`. See `docs/dashboard.md` |
| `scripts/` | Bun | `apply-migrations.ts`, `apply-grants.ts` (runs `db/grants*.sql` without psql), `import-sheet.ts` (one-time, idempotent import of the Sheet's CSV exports) |

## How parade states are parsed

Both intakes end at `api/parade.ts`, which calls `lib/pipeline.ts#ingestMessage`: store the
message idempotently on `wa_message_id`, parse it, and write its rows, all in one request.

```
WhatsApp group ─► whatsapp/ (first-parade check) ─► POST /api/parade  (Bearer PARADE_INGEST_SECRET, WhatsApp id)
Deposit page ─────────────────────────────────────► POST /api/parade  (session cookie, id = manual:<sha256>)
                                                        │
                                  recordMessage ─► parseBody ─► writeSubmission (one db.batch)
```

Parsing is `lib/parser/deterministic.ts` first: a rule-based reader of the standard template
(`parade-state-example/parade_state_template.txt`) that takes about a millisecond. It returns
`problems`, one for every line or header it cannot read with certainty (an unknown duty word
outside OTHERS, unreadable dates, a line outside any section, a missing company or date); the
rules never store a guess. Any problem at all hands the whole message to the model fallback,
`OpenAiParser` in `lib/parser/llm.ts` (prompt in `prompt.ts`, Structured Outputs schema in
`schema.ts`): `gpt-6-luna` (`OPENAI_MODEL` overrides) on the standard service tier, not flex,
because the call runs inside the intake request. `api/parade.ts` builds it from `OPENAI_API_KEY`
and gets `maxDuration: 300` in `vercel.json`; the relay waits as long. The model's extraction goes
through the same `validate`, and `parade_submissions.model` records which parser wrote the rows
(`deterministic` or the model id). With no key configured, or when the model call fails, no rows
are written: the message is stored with `error = 'Needs review: …'`, the intake answers 422 with
the problems, and a person corrects the text on the Deposit page. A filing habit that
keeps reaching the model is worth teaching the rules, with a synthetic case in
`test/lib/parser-deterministic.test.ts`.

A resend of a message that already parsed is left alone (`already_parsed`), so it cannot
replace a newer parade state with an older one; a message that failed is parsed again, which is
free. An edit (`editMessage`) parses the new text first and writes nothing if it does not
parse; otherwise it replaces the text and the rows in one batch, removing the submission under
the old key when the company, date or session changed. A delete removes the message and its
submission (the child rows cascade).

The relay retries a network failure or 5xx three times and treats 200 and 422 as final; a
message it still cannot deliver is logged for a clerk to deposit by hand.

## Rules that hold everywhere

- **One write path per stream.** Parade-state rows are written only by `lib/pipeline.ts`
  (called from `api/parade.ts`); FormSG rows only by `api/formsg.ts`. Callers never
  re-implement either.
- **One write path for settings.** `settings` rows are written only by `api/settings.ts`.
  Shared settings code (`src/model/settings/`) is pure JavaScript used by both the browser
  and the server; the server passes settings as values and never uses `active.js`.
- **Idempotency lives in the database.** Unique constraints (`wa_message_id`, FormSG
  submission id) settle duplicate deliveries in one statement; there are no app-level locks.
- **`neon-http` has no interactive transactions.** Atomic writes go through `db.batch([...])`,
  so no statement may depend on an earlier `RETURNING`; that is why `parade_response_id` is a
  computable natural key.
- **NRICs never reach the dashboard; message bodies reach only the Deposit editor.**
  FormSG NRIC answers resolve to `discard` in `lib/formsg/fields.ts` and have no column in
  `report_sick_formsg`. `raw_messages.body` leaves the database only through
  `GET /api/parade?id=`, one message at a time, to a caller holding the dashboard password, so
  a clerk can correct it; the list and every chart never carry it. Nothing logs a body, a parser
  problem or a rejection reason, since all three can quote a personnel line.
  The dashboard's read connects as `dashboard_read`, which cannot select `body`, and
  `lib/dashboard.ts` builds every tab from the header arrays in `src/data/tabs.js`, so a column
  leaves the database only if the dashboard asks for it; `test/dashboard/schema.test.js` and
  `test/lib/dashboard.test.ts` guard that no NRIC or body header is asked for.
- **Read what the message says; derive nothing.** The parser records only stated values; the
  one sanctioned exception is the permanent-status `num_days` sentinel. See `lib/parser/rows.ts`.
- **Fail closed on missing configuration.** A route with an unset secret refuses every request
  that secret would authorise. `api/parade.ts` checks bearer tokens in constant time; it has no
  lockout, so `DASHBOARD_PASSWORD` and `PARADE_INGEST_SECRET` must be long.
- **The browser holds a session, never a password.** `api/session.ts` exchanges
  `DASHBOARD_PASSWORD` for a read session cookie, or `SETTINGS_PASSWORD` for a read session
  plus a `settings_session` cookie, each signed with the password itself and carried
  `HttpOnly`, `Secure`, `SameSite=Strict`: page script cannot read either, and rotating a
  password ends every open session because the old signatures stop verifying. There is no
  session store — each cookie carries its own expiry, which is what makes it work on
  `neon-http`. A cookie-authorised write must also be same-origin (`Sec-Fetch-Site`, else
  `Origin` against `Host`), so a forged cross-site form cannot deposit, delete or save
  settings. `SETTINGS_PASSWORD` left unset, or equal to `DASHBOARD_PASSWORD`, fails closed:
  nobody can edit settings. The relay is not a browser and still uses its bearer token.

## Dashboard (`src/`)

Layers, dependency direction strictly downward:

| Layer | Holds | May import |
|---|---|---|
| `pages/` | one file per page; `pages/shared/` for the three category pages | everything below |
| `components/`, `charts/` | reusable panels, ECharts wrappers | `model/`, `theme/` |
| `app/` | shell, router, signals (`state.js`), session lifecycle and the background refresh (`auth.js`) | `data/`, `theme/` |
| `data/` | the `/api/dashboard` fetch and the headers asked of each tab (`feed.js`, `tabs.js`); the `/api/parade` calls (`parade.js`), which take the auth header from the page | `model/` |
| `model/` | every number and rule; pure functions, no DOM, no network | other `model/` files |

`model/` is the only layer under test and the only place a wrong number can come from. Every
colour is a token in `src/theme/tokens.css` (both themes), read by `src/charts/theme.js` at
paint time. `DESIGN.md` is the visual reference.

`model/settings/` holds the settings model: `defaults.js` (each section's default value and the
set of section names), `validate.js` (per-section validation, run both in the Settings page's
form and again in `api/settings.ts` before a save), `resolve.js` (merges a stored section over
its default, and is what `lib/settings.ts#readSettings` uses on the server), and `active.js`
(the settings in force for the currently loaded dashboard, which `src/data/feed.js` sets from
each `/api/dashboard` reply and `src/data/settings.js#unitSettings`/`refreshMs` read).

## Testing

`bun test` from the repo root (`./test/`; the WhatsApp bridge's tests are in `./test/whatsapp/`).

- **Pure suites always run**, offline: the parser, FormSG mapping (with the real SDK in its
  `test` mode), the dashboard model, the bridge's helpers, and every refusal a route makes
  before it touches the store (asserted against a store that throws if touched).
- **DB and end-to-end suites** run against a Neon test branch named by `TEST_DATABASE_URL`
  (see `.env.example`) through the app's own `neon-http` driver, and are skipped when it is
  unset. `test/support/db.ts` migrates the branch, empties every table before each test, and
  refuses a URL on the same endpoint as any app database. `test/e2e/` serves the three routes on
  a local port and drives them with the bridge's handler, the dashboard's `src/data/` calls and
  real signed FormSG webhooks, then checks what `src/model/` computes.
- **Only the OpenAI call is faked** (`ModelParser`), because it is a paid external API.
- Tests are data-driven over dummy data: `test/support/paradeState.ts` renders a parade state
  from a spec in the standard template, `scenarios.ts` holds named and seeded random specs, and
  expectations are counted off the spec rather than the implementation. Names are synthetic.
