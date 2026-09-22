# Architecture patterns

Canonical architecture reference for AI agents working in this repo. Read this before
codebase exploration, broad refactors, or architecture-impacting changes, and update it
whenever architecture or ownership boundaries change.

The Apps Script + Google Sheets implementation is retired and deleted (`legacy/`, the
`node:vm` harness and its tests); read it from git history if you need it. The deployed
Apps Script web app still serves the dashboard feed until the dashboard moves to Neon.

## Layout

| Path | Runtime | Owns |
|---|---|---|
| `db/` | Bun / Vercel | Drizzle schema (`schema.ts`), Neon connections (`index.ts`), migrations. Only tables something writes; dashboard tables and a read-only role arrive with the dashboard's move to Neon |
| `lib/` | Bun / Vercel | Shared domain: `pipeline.ts` (record → parse → validate → replace, plus edit and delete), `parser/`, `formsg/`, `http.ts`, `domain.ts` |
| `api/formsg.ts` | Vercel Function | FormSG webhook: verify signature, decrypt, map, insert one flat row into `report_sick_formsg` (sheet column order, plus derived `company`, `report_sick_date` (SGT), `received_at`, `symptom_category`, `symptom_other_text`) |
| `api/parade.ts` | Vercel Function | The parade-state intake: POST stores and parses one message (WhatsApp relay or dashboard deposit); GET/PUT/DELETE list, read, edit and delete stored messages for the dashboard (see below) |
| `whatsapp/` | Long-running Bun process on the ops laptop, started from the repo root with `bun run whatsapp` (root `package.json`, env from `.env.whatsapp`) | Baileys listener under `supervisor.js`. `ingest.js` relays each accepted message to `api/parade.ts`; it holds no database credentials |
| `src/`, `index.html` | Browser (Preact + Vite, deployed by Vercel) | The dashboard: read-only over the Apps Script feed, except the Parade States page, which writes through `api/parade.ts`. See `docs/dashboard.md` |
| `scripts/` | Bun | `apply-migrations.ts`, `apply-grants.ts` (runs `db/grants*.sql` without psql) |

## How parade states are parsed

Both intakes end at `api/parade.ts`, which calls `lib/pipeline.ts#ingestMessage`: store the
message idempotently on `wa_message_id`, parse it, and write its rows, all in one request.

```
WhatsApp group ─► whatsapp/ (first-parade check) ─► POST /api/parade  (Bearer PARADE_INGEST_SECRET, WhatsApp id)
Parade States page ───────────────────────────────► POST /api/parade  (Bearer dashboard password, id = manual:<sha256>)
                                                        │
                                  recordMessage ─► parseBody ─► writeSubmission (one db.batch)
```

Parsing is `lib/parser/deterministic.ts` alone: a rule-based reader of the standard template
(`parade-state-example/parade_state_template.txt`) that takes about a millisecond, which is what
lets parsing run inside a Vercel function. (It used to run on the laptop because the OpenAI
extractor it replaced took 74–126 s, past Hobby's 60 s cap. There is no model any more.) The
parser returns `problems`, one for every line or header it cannot read with certainty (an
unknown duty word outside OTHERS, unreadable dates, a line outside any section, a missing
company or date). Any problem at all means no rows: the message is stored with
`error = 'Needs review: …'`, the intake answers 422 with the problems, and a person corrects the
text on the Parade States page. The parser never stores a guess. A new filing habit that trips
it is fixed by teaching it one more rule, with a synthetic case in
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
- **Idempotency lives in the database.** Unique constraints (`wa_message_id`, FormSG
  submission id) settle duplicate deliveries in one statement; there are no app-level locks.
- **`neon-http` has no interactive transactions.** Atomic writes go through `db.batch([...])`,
  so no statement may depend on an earlier `RETURNING`; that is why `parade_response_id` is a
  computable natural key.
- **NRICs never reach the dashboard; message bodies reach only the Parade States editor.**
  FormSG NRIC answers resolve to `discard` in `lib/formsg/fields.ts` and have no column in
  `report_sick_formsg`. `raw_messages.body` leaves the database only through
  `GET /api/parade?id=`, one message at a time, to a caller holding the dashboard password, so
  a clerk can correct it; the list and every chart never carry it. Nothing logs a body, a parser
  problem or a rejection reason, since all three can quote a personnel line.
  `test/dashboard/schema.test.js` guards what the current sheet-backed dashboard requests.
- **Read what the message says; derive nothing.** The parser records only stated values; the
  one sanctioned exception is the permanent-status `num_days` sentinel. See `lib/parser/rows.ts`.
- **Fail closed on missing configuration.** A route with an unset secret refuses every request
  that secret would authorise. `api/parade.ts` checks bearer tokens in constant time; it has no
  lockout, so `DASHBOARD_PASSWORD` and `PARADE_INGEST_SECRET` must be long.

## Dashboard (`src/`)

Layers, dependency direction strictly downward:

| Layer | Holds | May import |
|---|---|---|
| `pages/` | one file per page; `pages/shared/` for the three category pages | everything below |
| `components/`, `charts/` | reusable panels, ECharts wrappers | `model/`, `theme/` |
| `app/` | shell, router, signals (`state.js`), password lifecycle (`auth.js`) | `data/`, `theme/` |
| `data/` | the feed `fetch` and the headers asked of each tab (`feed.js`, `tabs.js`); the `/api/parade` calls (`parade.js`), which take the auth header from the page | `model/` |
| `model/` | every number and rule; pure functions, no DOM, no network | other `model/` files |

`model/` is the only layer under test and the only place a wrong number can come from. Every
colour is a token in `src/theme/tokens.css` (both themes), read by `src/charts/theme.js` at
paint time. `DESIGN.md` is the visual reference.

## Testing

`bun test` from the repo root (`./test/`; the WhatsApp bridge's tests are in `./test/whatsapp/`). No network, no database,
no API key: routes take injected dependencies, and the dashboard's model layer is pure.
