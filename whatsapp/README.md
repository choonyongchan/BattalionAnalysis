# WhatsApp parade-state runner

Watches a WhatsApp group for first parade states, discards everything else, and relays each accepted message to
the Vercel intake, which stores and parses it.

```
WhatsApp group ─► first-parade check ─► POST /api/parade ─► recordMessage ─► parseBody ─► parade_submissions, ...
   (Baileys)         (signature.js)       (ingest.js)          (lib/pipeline.ts, on Vercel, against Neon)
```

The runner holds no database credentials and no API key: only the intake URL and `PARADE_INGEST_SECRET`. A
network failure or a 5xx is retried three times (2 s, then 4 s apart); a 200 or 422 is final. A message that
still could not be delivered is logged as `relay failed; deposit this parade state on the dashboard`, and a clerk
pastes it on the dashboard's Parade States page.

**History.** This relayed through Apps Script, then briefly through a Vercel Function plus a cron drain, then
stored and parsed on this process because the OpenAI extraction took 74–126 seconds, past Vercel Hobby's
60-second cap. The rule-based parser (`lib/parser/deterministic.ts`) takes about a millisecond, so parsing moved
back behind a Vercel Function and the model is gone.

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

The runner shares the repo root's `package.json`, and every command below runs **from the repo root**:

```bash
bun install
cp .env.whatsapp.example .env.whatsapp
```

Its settings live in `.env.whatsapp`, not `.env.local`, so the runner never sees the owner's `DATABASE_URL`.
`bun run whatsapp` loads only `.env.whatsapp` (`--env-file`), and the supervisor starts the bridge with
`whatsapp/` as its working directory so Bun cannot auto-load `.env.local`.

**1. Point at the intake.** Set `PARADE_API_URL` to the deployed route, e.g. `https://40sar.vercel.app/api/parade`.

**2. Share a secret.** Generate a long random value, put it in `PARADE_INGEST_SECRET` here and in the same
variable on Vercel, then redeploy.

**3. Pair WhatsApp and find the group.** Leave `WA_GROUP_ID` blank, set `LOG_LEVEL=debug` and `DRY_RUN=1`, then:

```bash
bun run whatsapp
```

Scan the QR code with *WhatsApp → Settings → Linked devices → Link a device*. With `WA_GROUP_ID` blank the
listener accepts every chat and logs each message's `remoteJid`, so posting once in the parade-state group
reveals its JID. Copy that into `WA_GROUP_ID` and restart.

**4. Dry run.** Still with `DRY_RUN=1`, post a real parade state and some chatter in the group. You should see
exactly one `DRY_RUN` line, and the chatter logged at `debug` with a rejection reason.

**5. Go live.** Set `DRY_RUN=0`, restore `LOG_LEVEL=info`, stop the foreground run (Ctrl+C), and move it to the
background with `bun run whatsapp:service install` — see [Task Scheduler](#task-scheduler-the-outer-layer).

## Running it permanently on Windows

`bun run whatsapp` launches a supervisor (`src/supervisor.js`), not the bridge directly. The supervisor spawns
`src/index.js` as a child, forwards its output, and restarts it on a crash **up to 3 consecutive times** with a
growing backoff (3s, 15s, 60s). A child that stayed up for 5 minutes before crashing is treated as a fresh
incident and the counter resets, so an occasional crash after hours of healthy running still gets the full
three attempts. After the 3rd consecutive restart the supervisor prints a fatal banner and exits non-zero.
A clean child exit (code 0), or the "session is dead" exit (code 3), is not restarted.

`bun run whatsapp:bridge` runs the bridge unsupervised — use it for debugging.

### Task Scheduler (the outer layer)

The supervisor gives up after 3 fast crashes, so something must relaunch *it*: a Windows scheduled task, managed
with one command. Nothing extra to install — it uses the built-in Task Scheduler.

**Going live:**

1. Pair once interactively with `bun run whatsapp` (the QR needs a terminal) and finish the dry run above.
2. In `.env.whatsapp`, set `DRY_RUN=0` and `LOG_LEVEL=info`, and check `WA_GROUP_ID` is set.
3. Open an **Administrator** terminal in the repo root and run `bun run whatsapp:service install`. It first stops
   any `bun run whatsapp` still running in a terminal, so two sockets never share `auth/`.
4. Run `bun run whatsapp:service status` and confirm the log shows `connected to WhatsApp`. To follow the log
   live: `Get-Content whatsapp\data\bridge.log -Wait -Tail 20`.

**Day to day** (everything except `status` needs an Administrator terminal):

```powershell
bun run whatsapp:service install   # register + start; safe to re-run
bun run whatsapp:service status    # task state + last log lines
bun run whatsapp:service stop      # disable the watchdog and kill the bridge
bun run whatsapp:service start
bun run whatsapp:service restart   # e.g. after editing .env.whatsapp
bun run whatsapp:service uninstall
```

`stop`, `restart` and `uninstall` kill only this bridge's bun processes (`whatsapp/src/supervisor.js` and
`index.js`), never other bun processes such as the Vite dev server.

`install` (`scripts/service.js`) registers the `WhatsAppBridge` scheduled task and disables sleep on AC power
(a sleeping PC receives nothing). What each piece buys:

- **Runs as SYSTEM** — starts at boot (e.g. after Windows Update) with nobody logged in, and needs no stored
  password.
- **Every-5-minutes trigger + `IgnoreNew`** is the watchdog: while the bridge runs, each tick is a no-op; once
  it is dead for any reason (supervisor gave up, killed, OOM), the next tick relaunches it. Worst-case gap is
  5 minutes, and no messages are lost — Baileys delivers what arrived while offline on reconnect.
- **`ExecutionTimeLimit` zero** — the default kills any task after 72 hours.
- A dead session (exit 3) is relaunched too and fails the same way each tick; `whatsapp\data\bridge.log` says to
  re-pair: `bun run whatsapp:service stop`, `bun run whatsapp:reset-auth`, `bun run whatsapp` (scan the QR, then
  Ctrl+C), `bun run whatsapp:service start`.

`whatsapp\data\bridge.log` is never rotated; truncate it by hand if it ever matters.

## Self-healing reconnect

The listener holds **exactly one** Baileys socket at a time. On a dropped connection it removes the old
socket's listeners and ends it *before* building a new one — two sockets writing `auth/` at once corrupt the
libsignal session, and every later decrypt then fails with `Bad MAC`.

Reconnect backoff is exponential: 3s, doubling each attempt, capped at 120s. After **5 consecutive failed
reconnects** the listener exits non-zero, and the supervisor starts a fresh process — a clean rebuild of
Baileys' in-memory state from `auth/` usually clears a wedged socket.

`loggedOut`, `badSession` and `connectionReplaced` are fatal: the listener prints "delete whatsapp/auth/ and
re-pair" and exits code 3, so the supervisor stops instead of looping into the same wall. Run
`bun run whatsapp:reset-auth` (deletes `auth/`), then `bun run whatsapp`, then scan the QR.

An isolated `Bad MAC` on a single inbound message is handled inside Baileys — that one message is dropped and
the socket keeps running. Nothing in the reconnect logic reacts to it.

## What gets relayed

Only **first parade states** reach the database. Chatter does not, and neither does a last parade state. The gates,
in order, all cheap:

1. **No last-parade marker in the header**: `LAST PARADE`, `LPS` or a bare `LP` as a whole word rejects the
   message outright, even if it also says `FPS`.
2. **A first-parade marker in the header**: `FIRST PARADE` (with or without `STATE`), `FPS`, or a bare `FP` as
   a whole word, in any case. There is no fallback. A header that says only `PARADE STATE`, or only `PS`, is
   rejected even with a morning timing, because it doesn't say which parade it is.
3. **Bulk**: ≥ 8 non-empty lines and ≥ 200 characters. The smallest real parade state runs about 32 lines /
   970 characters. `"Why is your parade state late?"` and `"40 SAR ARCHER COY FPS"` fail here or earlier.
4. **At least one present/strength line**: a label, a colon and a `present/strength` pair ending the line
   (`COMPANY: 197/210`, `[OFFICER]: 05/07`). Every parade state has these (template rule R10). A long
   reminder that mentions `FIRST PARADE STATE` has none, so it is rejected. A `DD/MM/YY` date does not count.

The header is the first 5 non-empty lines, where every company puts its company, date, session and timing.
Looking only there means a stray `FP` or `LP` in the body (someone's initials, say) cannot change the verdict.

All four real samples in `parade-state-example/` carry `FIRST PARADE STATE` and are accepted.

**There used to be a scoring stage:** a score over six layout signals, needing three matches to accept. It is
gone. Deciding whether a message is really a parade state is what `extract` and `validate` (`lib/parser/`) do,
and they do it by reading the message rather than guessing from its shape. The strength-line check above is
not a score: it is one yes/no signal that every parade state has. A message that clears these gates but is not a
parade state is still stored in `raw_messages`, with the reason in that row's `error` column, so a person can
review it.

To retune, edit the constants at the top of `src/signature.js`, then run `bun test ./test/whatsapp/`.

## Idempotency

The runner keeps **no** local record of what it has relayed. Dedup lives in Neon, on the `wa_message_id` unique
constraint on `raw_messages`, behind the intake: Baileys redelivers a message after a reconnect, and a process
restart has no memory of what it sent before it died, so both are harmless.

A resend of a message that already parsed comes back `already_parsed` and changes nothing. A resend of one that
failed to parse is parsed again, which picks up any rule the parser has learnt since.

## Layout

| File | Role |
|---|---|
| `src/supervisor.js` | Spawns and restarts the runner process (this is what `bun run whatsapp` runs) |
| `src/index.js` | Wiring and the message handler |
| `src/signature.js` | First-parade-state detection |
| `src/listener.js` | Baileys socket, single-socket reconnect, envelope filtering |
| `src/ingest.js` | Relays a message to `api/parade.ts`, retrying network failures and 5xx |
| `src/config.js` | `.env.whatsapp` validation |
| `src/logger.js` | pino logger factory |
| `scripts/service.js` | Installs and controls the background scheduled task (`bun run whatsapp:service`) |
| `scripts/reset-auth.js` | Wipes `auth/` for a clean re-pair (`bun run whatsapp:reset-auth`) |
| `../test/whatsapp/` | `bun test ./test/whatsapp/` — signature suite plus the non-network modules |

`auth/` and the root `.env.whatsapp` hold live credentials and are git-ignored. `src/appsScriptClient.js`, which relayed accepted
messages to the retired Apps Script web app, was deleted long ago; `src/ingest.js` now relays to Vercel instead.

## Troubleshooting

| Symptom | Cause |
|---|---|
| QR code appears on every start | `auth/` is not writable, or the device was unlinked in WhatsApp |
| `session logged out` / `session is dead` | Run `bun run whatsapp:reset-auth`, then `bun run whatsapp`, then scan the QR again |
| `failed to decrypt message` (`Invalid PreKey ID`, `No SenderKeyRecord`, `No session record`) soon after pairing | Normal for a newly linked device: the sender encrypted before learning its keys. Baileys asks the sender to resend, and the same message id is usually accepted seconds later. Stops once each member has sent once. Only a problem if one sender's messages never get through |
| Occasional `Bad MAC` in the log, runner keeps running | One inbound message failed to decrypt; Baileys drops it. No action — if it was a parade state, ask the sender to resend |
| Repeated `Bad MAC`, a reconnect loop, or `reconnect failed 5 times` | The libsignal session is corrupted or the device was unlinked. Stop the runner, `bun run whatsapp:reset-auth`, `bun run whatsapp`, re-scan |
| Supervisor logs `giving up after 3 consecutive restarts` | The child crashed 3× in quick succession. Read the child's last error printed just above the banner, fix the root cause, then `bun run whatsapp` |
| `Missing required environment variable ...` at start-up | `.env.whatsapp` is missing a required key, or the process was started some way other than `bun run whatsapp` (which passes `--env-file=.env.whatsapp`) |
| `relay failed; deposit this parade state on the dashboard` | Three attempts failed. `intake answered 401` means `PARADE_INGEST_SECRET` differs from Vercel's; `intake unreachable` or `5xx` means Vercel or the network was down. Paste the parade state on the dashboard's Parade States page |
| `parade state stored; needs correcting on the dashboard` | The parser was unsure of a line. Open Parade States on the dashboard; the row shows what to fix, and Edit re-parses it |
| A real parade state was rejected | Run with `LOG_LEVEL=debug`; the reason names the failing gate |
| A first parade state was rejected as "not a first parade state" | Its first 5 non-empty lines have no `FIRST PARADE` / `FPS` / `FP`. A plain `PARADE STATE` header is no longer enough, so ask the company to label the session |
| A first parade state was rejected for "no present/strength line" | No line ends in `label: present/strength` (e.g. `COMPANY: 197/210`). Check the strength lines follow the template |
