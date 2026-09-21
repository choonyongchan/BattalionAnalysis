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
| `db/` | Bun / Vercel | Drizzle schema (`schema.ts`), Neon connections (`index.ts`), migrations, the runner's role (`grants-ingest.sql`). Only tables something writes; dashboard tables and a read-only role arrive with the dashboard's move to Neon |
| `lib/` | Bun / Vercel | Shared domain: `pipeline.ts` (record → extract → validate → replace), `parser/`, `formsg/`, `http.ts`, `domain.ts` |
| `api/formsg.ts` | Vercel Function | FormSG webhook: verify signature, decrypt, map, insert one flat row into `report_sick_formsg` (sheet column order, plus derived `company`, `report_sick_date` (SGT), `received_at`, `symptom_category`, `symptom_other_text`) |
| `whatsapp/` | Long-running Bun process on the ops laptop | Baileys listener under `supervisor.js`; the only parade-state intake. `ingest.js` stores via `recordMessage` and drains via `parseDue` (see below) |
| `src/`, `index.html` | Browser (Preact + Vite, deployed by Vercel) | Read-only dashboard. See `docs/dashboard.md` |
| `scripts/` | Bun | `apply-migrations.ts`, `apply-grants.ts` (runs `db/grants*.sql` without psql) |

## How parade states are parsed

The runner stores each accepted message, then drains the backlog: once at start-up, on every
`PARSE_INTERVAL_MS` tick, and after every stored message. The drain is single-flight — a
call during a running drain only asks it to go round once more — so two `parseDue` runs never
pay twice for the same extraction. Parsing runs locally rather than on Vercel because one
extraction takes 74–126 s, past Hobby's 60 s cap, and Hobby refuses sub-daily crons. The
runner connects as `parade_ingest`, which can write parade-state tables and nothing else.

## Rules that hold everywhere

- **One write path per stream.** Parade-state rows are written only by `lib/pipeline.ts`;
  FormSG rows only by `api/formsg.ts`. Callers never re-implement either.
- **Idempotency lives in the database.** Unique constraints (`wa_message_id`, FormSG
  submission id) settle duplicate deliveries in one statement; there are no app-level locks.
- **`neon-http` has no interactive transactions.** Atomic writes go through `db.batch([...])`,
  so no statement may depend on an earlier `RETURNING`; that is why `parade_response_id` is a
  computable natural key.
- **NRICs and message bodies never reach the dashboard.** FormSG NRIC answers resolve to `discard` in
  `lib/formsg/fields.ts` and have no column in `report_sick_formsg`; `raw_messages.body` must stay
  unreadable by the future dashboard role. `test/dashboard/schema.test.js` guards what the
  current sheet-backed dashboard requests.
- **Read what the message says; derive nothing.** The parser records only stated values; the
  one sanctioned exception is the permanent-status `num_days` sentinel. See `lib/parser/rows.ts`.
- **Fail closed on missing configuration.** A route with an unset secret refuses every request.

## Dashboard (`src/`)

Layers, dependency direction strictly downward:

| Layer | Holds | May import |
|---|---|---|
| `pages/` | one file per page; `pages/shared/` for the three category pages | everything below |
| `components/`, `charts/` | reusable panels, ECharts wrappers | `model/`, `theme/` |
| `app/` | shell, router, signals (`state.js`), password lifecycle (`auth.js`) | `data/`, `theme/` |
| `data/` | the one `fetch`, and the headers asked of each tab | `model/` |
| `model/` | every number and rule; pure functions, no DOM, no network | other `model/` files |

`model/` is the only layer under test and the only place a wrong number can come from. Every
colour is a token in `src/theme/tokens.css` (both themes), read by `src/charts/theme.js` at
paint time. `DESIGN.md` is the visual reference.

## Testing

`bun test` from the repo root (`./test/` and `./whatsapp/test/`). No network, no database,
no API key: routes take injected dependencies, and the dashboard's model layer is pure.
