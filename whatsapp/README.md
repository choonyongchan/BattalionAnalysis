# WhatsApp parade-state runner

Watches a WhatsApp group for first parade states, discards everything else, and stores and parses the accepted
messages itself — no relay, no Apps Script, no Vercel Function in the loop.

```
WhatsApp group ─► first-parade check ─► recordMessage ─► parseDue ─► parade_submissions, strength_rows, ...
   (Baileys)         (signature.js)      (lib/pipeline.ts, on this Bun process, against Neon)
```

`recordMessage` stores the text idempotently and returns as soon as it is durable; `parseDue` does the extraction
and runs behind it, on a drain loop described under *Setup* and *Running it permanently on Windows* below. Storing
and parsing are split because one extraction takes 74–126 seconds, so a slow model delays a row, it never blocks
the socket that is still listening for the next message.

**History: this used to relay through Apps Script, and briefly through a Vercel Function plus a cron drain.**
Parsing moved onto this long-running process because 74–126 seconds is past the Vercel Hobby plan's 60-second
function cap, and Hobby also refuses the sub-daily cron that would otherwise have swept a backlog. The Vercel
webhook and cron drain this replaced (`api/whatsapp.ts`, `api/parse-due.ts`) have been deleted. The Apps Script project and its Google Form
fallback predate both and are fully decommissioned.

## Why Baileys

WhatsApp has no official API for reading group messages: Meta's WhatsApp Cloud API only receives one-to-one
messages sent to a business number. Group ingestion therefore requires an unofficial client.
[Baileys](https://github.com/WhiskeySockets/Baileys) speaks the WhatsApp Web protocol directly over a
WebSocket — no Chromium, ~50 MB of memory — and is **event-driven** (`messages.upsert`), so no polling loop is
needed despite the absence of webhooks.

The account is paired once by QR code and the session is persisted to `auth/`, so restarts do not need another
scan. This is an unofficial client, so use a secondary number if you can; a ban is unlikely for read-only
traffic but not impossible.

### Sustainable alternatives

If the unofficial-client risk is unacceptable long-term, the durable options are:

| Option | Group support | Notes |
|---|---|---|
| **WhatsApp Cloud API** | ✗ | Official webhooks, but 1:1 only. Companies would DM the parade state to a business number instead of posting in the group. |
| **Telegram Bot API** | ✓ | Official, free, native group support, real webhooks. The cleanest long-term home if the unit can move channels. |
| **Google Form** | n/a | History only — the Apps Script project and its Form fallback are decommissioned; this runner replaced them. |

## Setup

The runner imports `../lib` and `../db` from the repo root, so both the root package and this one need their
own install:

```bash
# from the repo root
bun install

cd whatsapp
bun install
cp .env.example .env
```

**1. Point at Neon.** Run `db/grants-ingest.sql` once against the database (see its header comment for the exact
`psql` invocation) to create the `parade_ingest` role, then put that role's connection string — **not** the
owner's — into `DATABASE_URL` in `whatsapp/.env`. That role can only store raw messages and write parsed rows.

**2. Add the OpenAI key.** Set `OPENAI_API_KEY`. `OPENAI_MODEL` is optional and defaults to whatever
`lib/parser/extract.ts` picks; `PARSE_INTERVAL_MS` (default 300000) is optional too — it only controls how often
leftovers are swept, since a new message is parsed as soon as it arrives.

**3. Pair WhatsApp and find the group.** Leave `WA_GROUP_ID` blank, set `LOG_LEVEL=debug` and `DRY_RUN=1`, then:

```bash
bun start
```

Scan the QR code with *WhatsApp → Settings → Linked devices → Link a device*. With `WA_GROUP_ID` blank the
listener accepts every chat and logs each message's `remoteJid`, so posting once in the parade-state group
reveals its JID. Copy that into `WA_GROUP_ID` and restart.

**4. Dry run.** Still with `DRY_RUN=1`, post a real parade state and some chatter in the group. You should see
exactly one `DRY_RUN` line, and the chatter logged at `debug` with a rejection reason.

**5. Go live.** Set `DRY_RUN=0`, restore `LOG_LEVEL=info`, and restart with `bun start`.

## Running it permanently on Windows

`bun start` launches a supervisor (`src/supervisor.js`), not the bridge directly. The supervisor spawns
`src/index.js` as a child, forwards its output, and restarts it on a crash **up to 3 consecutive times** with a
growing backoff (3s, 15s, 60s). A child that stayed up for 5 minutes before crashing is treated as a fresh
incident and the counter resets, so an occasional crash after hours of healthy running still gets the full
three attempts. After the 3rd consecutive restart the supervisor prints a fatal banner and exits non-zero.
A clean child exit (code 0), or the "session is dead" exit (code 3), is not restarted.

`bun run start:bridge` runs the bridge unsupervised — use it for debugging.

To start it at login, create a shortcut in `shell:startup` (Win+R → `shell:startup`) pointing at:

```
cmd /c "cd /d C:\Users\Administrator\Documents\Projects\BattalionDataAnalysis\whatsapp && bun start >> bridge.log 2>&1"
```

That shortcut (or Task Scheduler with "restart on failure", which also survives reboots) is the outer layer
that relaunches the supervisor itself after it gives up. It only runs while the machine is awake and logged
in. If uptime matters, move it to an always-on Linux host — nothing in the code is Windows-specific.

## Self-healing reconnect

The listener holds **exactly one** Baileys socket at a time. On a dropped connection it removes the old
socket's listeners and ends it *before* building a new one — two sockets writing `auth/` at once corrupt the
libsignal session, and every later decrypt then fails with `Bad MAC`.

Reconnect backoff is exponential: 3s, doubling each attempt, capped at 120s. After **5 consecutive failed
reconnects** the listener exits non-zero, and the supervisor starts a fresh process — a clean rebuild of
Baileys' in-memory state from `auth/` usually clears a wedged socket.

`loggedOut`, `badSession` and `connectionReplaced` are fatal: the listener prints "delete whatsapp/auth/ and
re-pair" and exits code 3, so the supervisor stops instead of looping into the same wall. Run
`bun run reset-auth` (deletes `auth/`), then `bun start`, then scan the QR.

An isolated `Bad MAC` on a single inbound message is handled inside Baileys — that one message is dropped and
the socket keeps running. Nothing in the reconnect logic reacts to it.

## What gets relayed

Chatter never reaches the database, and neither does any session other than the **first** parade. Two gates,
both cheap:

**Structural gates** — ≥ 8 non-empty lines, ≥ 200 characters, and the anchor phrase `/parade\s*state/i`. The
thresholds were calibrated against real parade-state messages, the smallest of which runs about 32 lines /
970 characters. `"Why is your parade state late?"` carries the anchor phrase but is one short line, so it
is rejected here.

A header that carries only `FPS` or `FP` as a whole token clears the structural gate even without the literal
words "PARADE STATE" — some companies label a first parade state that tersely. A bare `PS`, or `LP` / `LPS`
(a last parade state), does not. The ≥ 8 lines / ≥ 200 characters minimums still apply, so a terse one-liner
is still rejected.

**First-parade gate** — the message must either carry an explicit `FIRST PARADE` / `FPS` / `FP` marker in its
header, or have a timing before `12:00` in its header. The header is the first 5 non-empty lines, which is
where every company puts its company / date / session / timing block; confining the search there keeps stray
four-digit numbers — and a stray `FP` — in the body out of the check. The timing pattern uses digit lookaround
so it reads `0738` out of `220626 FP 0738` without ever matching inside the `DDMMYY` date, and still matches
when glued to a suffix (`0930HRS`).

Of the five real samples, four carry an explicit marker (`FIRST PARADE STATE`, or the bare `FIRST PARADE` in
`stallion.txt`); `braves.txt` is labelled only `PARADE STATE` and qualifies on its `0738` timing. A last parade
state has neither a first-parade marker nor a morning timing, so it is rejected.

**There used to be a third stage:** a score over six layout signals, needing three matches to accept. It is
gone. Deciding whether a message is really a parade state is what `extract` and `validate` (`lib/parser/`) do,
and they do it by reading the message rather than guessing from its shape — so the score was a second, weaker
copy of a judgement already being made downstream. What it added was a way to drop a genuine parade state whose
layout was merely unusual, with the rejection recorded nowhere but a debug log. A message that clears these two
gates but is not a parade state is still stored in `raw_messages`; `parseOne` (`lib/pipeline.ts`) calls `validate`
on what `extract` returned, and a non-empty reason goes into that row's `error` column via `markFailed`, which
also stamps `processed_at` so the row is not retried. The reason sits beside the message it came from, which is
visible in the database.

To retune, edit `MIN_LINES` / `MIN_CHARS` / `FIRST_PARADE_CUTOFF_HOUR` at the top of `src/signature.js`, then
run `bun test`.

## Idempotency

The runner keeps **no** local record of what it has stored. Dedup lives in Neon, on the `wa_message_id` unique
constraint on `raw_messages`: `recordMessage` inserts on conflict-do-nothing, so an insert that hits the
constraint tells the caller a row already exists rather than raising.

That is where the dedup has to be, not in-process — Baileys itself redelivers a message after a reconnect, and a
process restart has no memory of what it stored before it died. A message that exists but was never parsed comes
back from `recordMessage` as `duplicate`, not `stored` — that status only reports whether this call inserted the
row, and either way `parseDue` picks the row up on the next drain, since it selects on `processed_at IS NULL`
rather than on what `recordMessage` reported. That is how a row stranded by a crashed parse gets picked up again
instead of being silently skipped.

## Layout

| File | Role |
|---|---|
| `src/supervisor.js` | Spawns and restarts the runner process (this is what `bun start` runs) |
| `src/index.js` | Wiring and the message handler |
| `src/signature.js` | First-parade-state detection |
| `src/listener.js` | Baileys socket, single-socket reconnect, envelope filtering |
| `src/ingest.js` | Calls `recordMessage` / `parseDue` (`../../lib/pipeline.ts`) and runs the single-flight drain loop |
| `src/config.js` | `.env` loading and validation |
| `src/logger.js` | pino logger factory |
| `scripts/reset-auth.js` | Wipes `auth/` for a clean re-pair (`bun run reset-auth`) |
| `test/` | `bun test` — signature suite plus the non-network modules |

`auth/` and `.env` hold live credentials and are git-ignored. `src/appsScriptClient.js`, which relayed accepted
messages to the retired Apps Script web app, was deleted when storage and parsing moved into `src/ingest.js`.

## Troubleshooting

| Symptom | Cause |
|---|---|
| QR code appears on every start | `auth/` is not writable, or the device was unlinked in WhatsApp |
| `session logged out` / `session is dead` | Run `bun run reset-auth`, then `bun start`, then scan the QR again |
| Occasional `Bad MAC` in the log, runner keeps running | One inbound message failed to decrypt; Baileys drops it. No action — if it was a parade state, ask the sender to resend |
| Repeated `Bad MAC`, a reconnect loop, or `reconnect failed 5 times` | The libsignal session is corrupted or the device was unlinked. Stop the runner, `bun run reset-auth`, `bun start`, re-scan |
| Supervisor logs `giving up after 3 consecutive restarts` | The child crashed 3× in quick succession. Read the child's last error printed just above the banner, fix the root cause, then `bun start` |
| `Missing required environment variable ...` at start-up | `whatsapp/.env` is missing a required key, or the process was started from somewhere other than `whatsapp/` — Bun only loads `.env` out of the working directory |
| `parse run failed; will retry on the next drain` in the log | `parseDue` threw — usually `DATABASE_URL` unreachable or the OpenAI call failed. The message stays unparsed and the next drain (on `PARSE_INTERVAL_MS`, or the next incoming message) retries it |
| A message is stored but never parses | A 401/429/outage does not throw out of `parseDue` — it only shows up as `failed: N` in the `parse run finished` log, and the row's `raw_messages.error` stays empty since a transient failure is never written there. Check `OPENAI_API_KEY` is valid and has quota, and that `OPENAI_MODEL` (if set) names a real model |
| A real parade state was rejected | Run with `LOG_LEVEL=debug`; the reason names the failing gate |
| A first parade state was rejected as "not a first parade state" | Its header has no `FIRST PARADE` marker and no timing before 12:00 — check the timing is in the first 5 non-empty lines |
