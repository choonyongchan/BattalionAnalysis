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

**5. Go live.** Set `DRY_RUN=0`, restore `LOG_LEVEL=info`, and restart with `bun run whatsapp`.

## Running it permanently on Windows

`bun run whatsapp` launches a supervisor (`src/supervisor.js`), not the bridge directly. The supervisor spawns
`src/index.js` as a child, forwards its output, and restarts it on a crash **up to 3 consecutive times** with a
growing backoff (3s, 15s, 60s). A child that stayed up for 5 minutes before crashing is treated as a fresh
incident and the counter resets, so an occasional crash after hours of healthy running still gets the full
three attempts. After the 3rd consecutive restart the supervisor prints a fatal banner and exits non-zero.
A clean child exit (code 0), or the "session is dead" exit (code 3), is not restarted.

`bun run whatsapp:bridge` runs the bridge unsupervised — use it for debugging.

### Task Scheduler (the outer layer)

The supervisor gives up after 3 fast crashes, so something must relaunch *it*. Pair once interactively with
`bun run whatsapp` (the QR needs a terminal), stop it, then register the task from an elevated PowerShell in the
repo root:

```powershell
New-Item -ItemType Directory -Force whatsapp\data | Out-Null
$bun  = (Get-Command bun).Source
$act  = New-ScheduledTaskAction -Execute cmd.exe -WorkingDirectory $PWD `
          -Argument "/c `"`"$bun`" --env-file=.env.whatsapp whatsapp\src\supervisor.js >> whatsapp\data\bridge.log 2>&1`""
$trig = @(
  New-ScheduledTaskTrigger -AtStartup
  New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
)
$set  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
          -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
          -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
$cred = Get-Credential $env:USERNAME
Register-ScheduledTask WhatsAppBridge -Action $act -Trigger $trig -Settings $set `
  -User $cred.UserName -Password $cred.GetNetworkCredential().Password
powercfg /change standby-timeout-ac 0   # a sleeping PC receives nothing
```

What each piece buys:

- **Every-5-minutes trigger + `IgnoreNew`** is the watchdog: while the bridge runs, each tick is a no-op; once
  it is dead for any reason (supervisor gave up, killed, OOM), the next tick relaunches it. Worst-case gap is
  5 minutes, and no messages are lost — Baileys delivers what arrived while offline on reconnect.
- **`ExecutionTimeLimit` zero** — the default kills any task after 72 hours.
- **User + password** — "run whether logged on or not", so it survives reboots (Windows Update) with nobody
  logged in.
- A dead session (exit 3) is relaunched too and fails the same way each tick; `whatsapp\data\bridge.log` says to
  re-pair. Stop it with `Disable-ScheduledTask WhatsAppBridge; Get-Process bun | Stop-Process`.

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
run `bun test ./test/whatsapp/`.

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
| `scripts/reset-auth.js` | Wipes `auth/` for a clean re-pair (`bun run whatsapp:reset-auth`) |
| `../test/whatsapp/` | `bun test ./test/whatsapp/` — signature suite plus the non-network modules |

`auth/` and the root `.env.whatsapp` hold live credentials and are git-ignored. `src/appsScriptClient.js`, which relayed accepted
messages to the retired Apps Script web app, was deleted long ago; `src/ingest.js` now relays to Vercel instead.

## Troubleshooting

| Symptom | Cause |
|---|---|
| QR code appears on every start | `auth/` is not writable, or the device was unlinked in WhatsApp |
| `session logged out` / `session is dead` | Run `bun run whatsapp:reset-auth`, then `bun run whatsapp`, then scan the QR again |
| Occasional `Bad MAC` in the log, runner keeps running | One inbound message failed to decrypt; Baileys drops it. No action — if it was a parade state, ask the sender to resend |
| Repeated `Bad MAC`, a reconnect loop, or `reconnect failed 5 times` | The libsignal session is corrupted or the device was unlinked. Stop the runner, `bun run whatsapp:reset-auth`, `bun run whatsapp`, re-scan |
| Supervisor logs `giving up after 3 consecutive restarts` | The child crashed 3× in quick succession. Read the child's last error printed just above the banner, fix the root cause, then `bun run whatsapp` |
| `Missing required environment variable ...` at start-up | `.env.whatsapp` is missing a required key, or the process was started some way other than `bun run whatsapp` (which passes `--env-file=.env.whatsapp`) |
| `relay failed; deposit this parade state on the dashboard` | Three attempts failed. `intake answered 401` means `PARADE_INGEST_SECRET` differs from Vercel's; `intake unreachable` or `5xx` means Vercel or the network was down. Paste the parade state on the dashboard's Parade States page |
| `parade state stored; needs correcting on the dashboard` | The parser was unsure of a line. Open Parade States on the dashboard; the row shows what to fix, and Edit re-parses it |
| A real parade state was rejected | Run with `LOG_LEVEL=debug`; the reason names the failing gate |
| A first parade state was rejected as "not a first parade state" | Its header has no `FIRST PARADE` marker and no timing before 12:00 — check the timing is in the first 5 non-empty lines |
