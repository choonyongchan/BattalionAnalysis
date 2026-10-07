# Developer guide

How to set up, change, test and ship this project. Read
[architecture_patterns.md](architecture_patterns.md) next: it is the reference for what owns what
and the rules every change keeps. [security.md](security.md) covers the personal data.

## What runs where

```
WhatsApp group ──► runner/ (ops laptop) ──┐
Deposit page (frontend/) ─────────────────┼──► backend/api/parade.ts ──► Neon Postgres
FormSG webhooks ──────────────────────────┘    backend/api/reportsick.ts, sft.ts
                                                             │
Dashboard (frontend/, browser) ◄── backend/api/dashboard.ts ◄┘  (read-only role)
```

| Folder | What it is | Runs on |
|---|---|---|
| `frontend/` | The Preact + Vite dashboard | The browser, served by Vercel |
| `backend/` | Vercel Functions (`api/`), shared server code (`lib/`), schema and migrations (`db/`), maintenance scripts (`scripts/`) | Vercel; scripts on your machine |
| `runner/` | The WhatsApp listener that relays parade states to the intake | The ops laptop, as a scheduled task |
| `shared/` | Pure JavaScript used by both browser and server: vocabulary, dates, identity, settings rules | Both |
| `test/` | Every test suite, mirroring the folders above | Your machine and CI |
| `docs/` | This guide, architecture, dashboard design notes, security, `DESIGN.md` (visual reference) | — |

## Set up

You need [Bun](https://bun.sh) 1.3+. Use `bun`, never `npm` or `npx`.

```sh
bun install                         # all workspaces, one lockfile
cp .env.example .env.local          # app secrets, never committed
cp .env.example .env.test           # set TEST_DATABASE_URL to a Neon *branch*
```

Ask the maintainer for a Neon test branch URL. Never point `TEST_DATABASE_URL` at production:
the test suite empties every table, and refuses a URL on the same endpoint as an app database.

## Run the dashboard locally

```sh
bun run dev:api      # terminal 1: API on :3001 over 4 weeks of synthetic data (empties the test branch)
bun run dev          # terminal 2: Vite on :5173, proxying /api to :3001
```

Open http://localhost:5173 and log in with `DASHBOARD_PASSWORD` or `SETTINGS_PASSWORD` from
`test/support/app.ts`. All names are synthetic. Running `bun test` empties the branch again; restart
`dev:api` to refill it.

## Test

```sh
bun test               # everything; DB and end-to-end suites skip when TEST_DATABASE_URL is unset
bun run test:coverage  # what CI runs; writes coverage/lcov.info
bun run typecheck      # tsc over backend/ and test/
```

- The model layer (`frontend/src/model/`, `shared/`) holds every number on screen and is where
  logic is tested. Pages and charts only draw what it returns.
- Test data is synthetic and data-driven: `test/support/paradeState.ts` renders a parade state from a
  spec, `scenarios.ts` holds named and seeded random specs. Never paste a real parade state into a
  test.
- `test/backend/lib/parser-llm-live.test.ts` calls OpenAI when `OPENAI_API_KEY` is in `.env.test`;
  remove the key to skip it.

CI (`.github/workflows/ci.yml`) runs the coverage suite on every push and pull request to `main`.

## Deploy

Vercel builds from GitHub `main`. The project's **Root Directory is `backend`**:
`backend/vercel.json` installs from the repo root, builds the frontend into `backend/public`, and
sets the security headers. Pushing a branch gives a preview deployment.

Environment variables (Vercel → Project Settings → Environment Variables; template in
`.env.example`):

| Variable | Used by |
|---|---|
| `DATABASE_URL` | Writes: intake, webhooks, settings, migrations |
| `DASHBOARD_DATABASE_URL` | The dashboard read, as `dashboard_read` |
| `DASHBOARD_PASSWORD`, `SETTINGS_PASSWORD` | Logins (read; read-write) |
| `SESSION_SECRET` | Signs session cookies; unset means nobody can log in |
| `PARADE_INGEST_SECRET` | The runner's bearer token (also in `.env.whatsapp`) |
| `FORMSG_SECRET_KEY`, `FORMSG_POST_URI` | Report-sick webhook |
| `FORMSG_SFT_SECRET_KEY`, `FORMSG_SFT_POST_URI` | SFT webhook |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Parser fallback (optional) |

## Change the database

1. Edit `backend/db/schema.ts`, then `bun run db:generate` (or `bun run --cwd backend drizzle-kit
   generate --custom --name <name>` for hand-written SQL).
2. Rehearse on the test branch: `bun test` migrates it.
3. **Before the code deploys**, run `bun run db:migrate` against production. Code that needs a new
   column fails on every request until the migration is applied (see `tasks/lessons.md`).
4. Never re-run `backend/scripts/apply-grants.ts` casually: it rotates `dashboard_read`'s password,
   and the dashboard 500s until `DASHBOARD_DATABASE_URL` is updated on Vercel.

## Operate the WhatsApp runner

Full detail in [runner/README.md](../runner/README.md). Day to day, from the repo root in an
Administrator terminal:

```sh
bun run runner:service status     # is it running, last log lines
bun run runner:service stop       # stop it
bun run runner:service install    # (re)register and start; use this to restart
```

`runner/auth/` holds the paired WhatsApp session: moving or deleting it means re-pairing by QR.

## Common changes

- **Teach the parser a filing habit.** Add a synthetic case to
  `test/backend/lib/parser-deterministic.test.ts`, then change `backend/lib/parser/deterministic.ts`
  until it passes. A message the rules doubt goes to the model, or waits for a clerk.
- **Add a chart.** Compute the numbers in `frontend/src/model/` with a test. Pick the chart by the
  question (see "Each chart type answers one kind of question" in `docs/dashboard.md`), wrap it in
  `ChartCard`, and give it a title, a coverage line and an empty-state sentence. A new ECharts series
  type is registered once in `frontend/src/charts/echarts.js`.
- **Add a dashboard column.** Add the header to `shared/tabs.js`; `backend/lib/dashboard.ts` builds
  every tab from those arrays. A column with personal data needs a reason in the pull request.
- **Add a settings section.** Default in `shared/settings/defaults.js`, validation in
  `shared/settings/validate.js` (run by both the form and `backend/api/settings.ts`), editor in
  `frontend/src/pages/settings/`.

## Conventions

- Smallest change that works; delete code rather than leave it unused.
- Google-style docstrings (JSDoc in JavaScript) on every function and module.
- Colours only as tokens in `frontend/src/theme/tokens.css`, in both themes.
- Never log a message body, a parser problem, a rejection reason or a FormSG answer.
