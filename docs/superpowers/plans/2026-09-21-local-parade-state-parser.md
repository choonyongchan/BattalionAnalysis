# Local Parade-State Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move parade-state parsing from Vercel (`api/whatsapp.ts` + `api/parse-due.ts` + cron) into the local WhatsApp runner, which writes raw messages and parsed rows straight to Neon.

**Architecture:** The runner calls the existing `recordMessage` and `parseDue` from `lib/pipeline.ts` in-process, instead of POSTing to Apps Script. A small single-flight "ingestor" in `whatsapp/src/ingest.js` stores each accepted message, then drains the parse queue in the background: one parse run at a time, re-run if more work arrived, plus a drain at start-up and on a timer to pick up transient failures. Vercel keeps only the dashboard and `api/formsg.ts`. That removes the Hobby-plan problems: sub-daily crons are refused, and 60 s is shorter than one 74–126 s extraction.

**Tech Stack:** Bun (runtime + `bun test`), Baileys, pino, Drizzle ORM over `@neondatabase/serverless` (neon-http), OpenAI via `lib/parser/extract.ts`.

**Spec:** This conversation's decision (2026-09-21): "move the parser to the local machine by the WhatsApp runner, and the runner will input the parsed data into the Neon database". Context: `docs/architecture_patterns.md`, `lib/pipeline.ts` header comment.

## Global Constraints

- Use `bun`, never `npm`/`npx`.
- Keep the supervisor (`whatsapp/src/supervisor.js`) and pino. Do not propose removing either.
- Google-style docstrings (JSDoc in `.js`, TSDoc in `.ts`) on every function, matching the surrounding files.
- Exactly one code path writes parade-state rows: `lib/pipeline.ts`. The runner calls it and must not re-implement any of it.
- Never log a message body, a name or an NRIC. Log message ids, counts and outcomes only.
- Two `parseDue` runs must never overlap. Overlapping runs pay twice for the same extraction (see the `api/parse-due.ts` header).
- The runner imports root code (`../../lib`, `../../db`), so the machine running it must have a root `bun install` as well as `whatsapp/`'s.
- Full suite from the repo root: `bun test ./test/ ./whatsapp/test/`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `whatsapp/src/ingest.js` | Create | `createIngestor`: store a message, then single-flight drain of the parse queue |
| `whatsapp/test/ingest.test.js` | Create | Unit tests with fake `record`/`parse`, no database |
| `whatsapp/src/config.js` | Modify | Replace `APPS_SCRIPT_URL`/`APPS_SCRIPT_TOKEN` with `DATABASE_URL`, `OPENAI_API_KEY`, optional `OPENAI_MODEL`, `PARSE_INTERVAL_MS` |
| `whatsapp/src/index.js` | Modify | Handler calls the ingestor; `main` builds it, drains at start-up and on an interval |
| `whatsapp/src/appsScriptClient.js` | Delete | The Apps Script relay is gone |
| `whatsapp/test/bridge.test.js` | Modify | Config tests use the new vars; relay tests removed; handler tests use a fake ingestor |
| `whatsapp/.env.example` | Modify | New variables |
| `whatsapp/package.json` | Modify | Description no longer says Google Sheets |
| `db/grants-ingest.sql` | Create | `parade_ingest` role: only what `lib/pipeline.ts` needs |
| `api/whatsapp.ts`, `api/parse-due.ts`, `test/api/whatsapp.test.ts`, `test/api/parse-due.test.ts` | Delete (Task 6) | Retired Vercel intake |
| `.env.example`, `lib/pipeline.ts` (header comment), `docs/architecture_patterns.md`, `whatsapp/README.md` | Modify | Say where parsing now happens |

---

### Task 1: The ingestor

**Files:**
- Create: `whatsapp/src/ingest.js`
- Test: `whatsapp/test/ingest.test.js`

**Interfaces:**
- Consumes: `recordMessage(db, { waMessageId, body, source? }) → Promise<RecordOutcome>` and `parseDue(db, { apiKey, model?, limit? }) → Promise<ParseRun>` from `lib/pipeline.ts` (injected; defaults imported).
- Produces: `createIngestor({ db, apiKey, model?, logger, record?, parse? }) → { ingest(text, messageId): Promise<RecordOutcome>, drain(): Promise<void> }`, and `tallyRun(run) → { parsed, rejected, failed, skipped }`.

- [ ] **Step 1: Write the failing tests**

`whatsapp/test/ingest.test.js`:

```js
/**
 * Tests for the ingestor: storing a message, and draining the parse queue one
 * run at a time. The database and the model are both faked, since lib/pipeline.ts
 * has its own tests. What is under test here is the scheduling around it.
 */

import { describe, expect, test } from 'bun:test';
import { createIngestor, tallyRun } from '../src/ingest.js';

/** @type {import('pino').Logger} A logger stub that records nothing. */
const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

/**
 * A parse run with no work in it.
 *
 * @returns {{results: !Array<!Object>, skipped: number, stoppedEarly: boolean}}
 */
function emptyRun() {
  return { results: [], skipped: 0, stoppedEarly: false };
}

/**
 * A promise with its resolver exposed, so a test controls when a fake parse ends.
 *
 * @returns {{promise: !Promise<void>, resolve: function(): void}}
 */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('tallyRun', () => {
  test('counts results by outcome and carries skipped', () => {
    const run = {
      results: [{ outcome: 'parsed' }, { outcome: 'parsed' }, { outcome: 'rejected' }, { outcome: 'failed' }],
      skipped: 3,
      stoppedEarly: false,
    };
    expect(tallyRun(run)).toEqual({ parsed: 2, rejected: 1, failed: 1, skipped: 3 });
  });
});

describe('createIngestor.ingest', () => {
  test('stores the message under its WhatsApp id', async () => {
    const recorded = [];
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: silentLogger,
      record: async (db, message) => {
        recorded.push([db, message]);
        return { status: 'stored', id: 1 };
      },
      parse: async () => emptyRun(),
    });

    expect(await ingestor.ingest('PARADE STATE', 'MSG1')).toEqual({ status: 'stored', id: 1 });
    expect(recorded).toEqual([['DB', { waMessageId: 'MSG1', body: 'PARADE STATE', source: 'whatsapp' }]]);
  });

  test('starts a drain after storing, without waiting for it', async () => {
    const gate = deferred();
    let parseCalls = 0;
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: silentLogger,
      record: async () => ({ status: 'stored', id: 1 }),
      parse: async () => {
        parseCalls += 1;
        await gate.promise;
        return emptyRun();
      },
    });

    // ingest resolves while the parse is still blocked on the gate.
    await ingestor.ingest('PARADE STATE', 'MSG1');
    expect(parseCalls).toBe(1);
    gate.resolve();
    await ingestor.drain();
  });

  test('does not drain for a message that was already processed', async () => {
    let parseCalls = 0;
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: silentLogger,
      record: async () => ({ status: 'already_processed', id: 1, paradeResponseId: 'X', error: null }),
      parse: async () => {
        parseCalls += 1;
        return emptyRun();
      },
    });

    await ingestor.ingest('PARADE STATE', 'MSG1');
    expect(parseCalls).toBe(0);
  });
});

describe('createIngestor.drain', () => {
  test('never runs two parses at once, and re-runs once for work that arrived meanwhile', async () => {
    const gate = deferred();
    let active = 0;
    let maxActive = 0;
    let parseCalls = 0;
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: silentLogger,
      record: async () => ({ status: 'stored', id: 1 }),
      parse: async () => {
        parseCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (parseCalls === 1) await gate.promise;
        active -= 1;
        return emptyRun();
      },
    });

    const first = ingestor.drain();
    ingestor.drain();
    ingestor.drain();
    gate.resolve();
    // `first` resolves only after the follow-up pass, since both run inside one loop.
    await first;

    expect(maxActive).toBe(1);
    // The first run, plus exactly one follow-up for the two drains that arrived during it.
    expect(parseCalls).toBe(2);
  });

  test('keeps going while the run reports a backlog beyond its limit', async () => {
    const runs = [
      { results: [{ outcome: 'parsed' }], skipped: 1, stoppedEarly: false },
      { results: [{ outcome: 'parsed' }], skipped: 0, stoppedEarly: false },
    ];
    let parseCalls = 0;
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: silentLogger,
      record: async () => ({ status: 'stored', id: 1 }),
      parse: async () => runs[parseCalls++],
    });

    await ingestor.drain();
    expect(parseCalls).toBe(2);
  });

  test('passes the API key and model through to parseDue', async () => {
    const seen = [];
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'sk-test',
      model: 'gpt-test',
      logger: silentLogger,
      parse: async (db, options) => {
        seen.push([db, options]);
        return emptyRun();
      },
    });

    await ingestor.drain();
    expect(seen).toEqual([['DB', { apiKey: 'sk-test', model: 'gpt-test' }]]);
  });

  test('swallows a failed run, so the listener survives and the next drain still works', async () => {
    let parseCalls = 0;
    const errors = [];
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: { ...silentLogger, error: (fields) => errors.push(fields) },
      parse: async () => {
        parseCalls += 1;
        if (parseCalls === 1) throw new Error('neon unreachable');
        return emptyRun();
      },
    });

    await ingestor.drain();
    await ingestor.drain();

    expect(parseCalls).toBe(2);
    expect(errors).toHaveLength(1);
    expect(errors[0].err).toBe('neon unreachable');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test ./whatsapp/test/ingest.test.js`
Expected: FAIL. The error is `Cannot find module '../src/ingest.js'`.

- [ ] **Step 3: Write the implementation**

`whatsapp/src/ingest.js`:

```js
/**
 * Stores accepted parade states in Neon and parses them, on this machine.
 *
 * This replaced a relay to Apps Script and, briefly, to a Vercel route plus a
 * cron drain. Parsing moved here because one extraction takes 74-126 seconds.
 * That is past Vercel Hobby's 60-second function cap, and Hobby also refuses
 * sub-daily crons. A long-running process has neither limit.
 *
 * Every write still goes through lib/pipeline.ts: `recordMessage` stores the
 * text idempotently on the WhatsApp message id, and `parseDue` extracts and
 * replaces rows. Nothing here touches a table directly.
 *
 * Storing and parsing stay split, as they were on Vercel. `ingest` returns once
 * the text is durable, and the parse runs behind it. A crash mid-parse
 * therefore loses nothing: the row stays unprocessed and the next drain,
 * including the one at start-up, picks it up.
 */

import { parseDue, recordMessage } from '../../lib/pipeline.ts';

/**
 * Counts a parse run's results by outcome, for logging.
 *
 * Counts only. A result's reason can quote the message, and the message holds
 * names and NRICs, so none of it goes to the log.
 *
 * @param {{results: !Array<{outcome: string}>, skipped: number}} run What
 *   `parseDue` returned.
 * @returns {{parsed: number, rejected: number, failed: number, skipped: number}}
 *   The tally.
 */
export function tallyRun(run) {
  const tally = { parsed: 0, rejected: 0, failed: 0, skipped: run.skipped };
  for (const result of run.results) tally[result.outcome] += 1;
  return tally;
}

/**
 * Builds the ingestor the message handler and the drain timer share.
 *
 * `drain` is single-flight. A call made while a run is in progress does not
 * start a second one. It marks that more work may have arrived, and the running
 * drain goes round once more before it finishes. Two overlapping `parseDue`
 * runs would select the same rows and pay twice for each extraction.
 *
 * @param {Object} deps Dependencies.
 * @param {*} deps.db A read-write Drizzle handle, from `getDb()`.
 * @param {string} deps.apiKey OpenAI API key.
 * @param {string=} deps.model OpenAI model override.
 * @param {import('pino').Logger} deps.logger Logger for outcomes.
 * @param {typeof recordMessage=} deps.record Injected in tests.
 * @param {typeof parseDue=} deps.parse Injected in tests.
 * @returns {{ingest: function(string, string): !Promise<Object>,
 *   drain: function(): !Promise<void>}} The ingestor.
 */
export function createIngestor({ db, apiKey, model, logger, record = recordMessage, parse = parseDue }) {
  /** @type {?Promise<void>} The drain in progress, if any. */
  let running = null;
  /** @type {boolean} Whether another pass is needed after the current one. */
  let again = false;

  /**
   * Runs parse passes until nothing new has arrived and no backlog remains.
   *
   * @returns {!Promise<void>} Resolves when the queue is drained or a pass fails.
   */
  async function loop() {
    try {
      let more = true;
      while (more) {
        again = false;
        const run = await parse(db, { apiKey, model });
        const tally = tallyRun(run);
        if (run.results.length > 0) logger.info(tally, 'parse run finished');
        more = again || run.skipped > 0;
      }
    } catch (err) {
      // Swallowed deliberately: an unreachable database must not take down the
      // listener. The messages stay unprocessed and the next drain retries them.
      logger.error({ err: err.message }, 'parse run failed; will retry on the next drain');
    } finally {
      running = null;
    }
  }

  /**
   * Drains the parse queue, or asks the drain already in progress to go again.
   *
   * @returns {!Promise<void>} Resolves when the drain covering this call ends.
   */
  function drain() {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  }

  /**
   * Stores one message, then starts a drain without waiting for it.
   *
   * @param {string} text The parade-state text.
   * @param {string} messageId The Baileys message id.
   * @returns {!Promise<Object>} The `recordMessage` outcome.
   */
  async function ingest(text, messageId) {
    const outcome = await record(db, { waMessageId: messageId, body: text, source: 'whatsapp' });
    if (outcome.status !== 'already_processed') drain();
    return outcome;
  }

  return { ingest, drain };
}
```

The test "passes the API key and model through" expects exactly `{ apiKey, model }`. Pass nothing else: `parseDue` defaults `limit` to 20, and without a `deadline` it runs until it finishes.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test ./whatsapp/test/ingest.test.js`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add whatsapp/src/ingest.js whatsapp/test/ingest.test.js
git commit -m "feat(whatsapp): ingestor that stores and parses parade states locally"
```

---

### Task 2: Configuration

**Files:**
- Modify: `whatsapp/src/config.js` (`loadConfig`)
- Modify: `whatsapp/test/bridge.test.js` (`sampleEnv`, `describe('loadConfig')`)
- Modify: `whatsapp/.env.example`

**Interfaces:**
- Produces: `loadConfig()` returns `{ groupId, databaseUrl, openaiApiKey, openaiModel, parseIntervalMs, logLevel, dryRun, authDir }`. `openaiModel` is `undefined` when unset, so `parseDue` keeps its default. `parseIntervalMs` defaults to `300000`.

- [ ] **Step 1: Update the tests first**

In `whatsapp/test/bridge.test.js`, replace `sampleEnv` and the whole `describe('loadConfig', ...)` block:

```js
function sampleEnv(overrides = {}) {
  return {
    WA_GROUP_ID: GROUP_JID,
    DATABASE_URL: 'postgresql://parade_ingest:pw@host/db?sslmode=require',
    OPENAI_API_KEY: 'sk-test',
    ...overrides,
  };
}
```

```js
describe('loadConfig', () => {
  test('reads the required settings', () => {
    const config = loadConfig({ env: sampleEnv() });
    expect(config.groupId).toBe(GROUP_JID);
    expect(config.databaseUrl).toContain('parade_ingest');
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.openaiModel).toBeUndefined();
    expect(config.parseIntervalMs).toBe(300_000);
    expect(config.dryRun).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  test.each(['WA_GROUP_ID', 'DATABASE_URL', 'OPENAI_API_KEY'])('rejects a missing %s', (key) => {
    const env = sampleEnv();
    delete env[key];
    expect(() => loadConfig({ env })).toThrow(new RegExp(key));
  });

  test('rejects a blank required setting, not just an absent one', () => {
    expect(() => loadConfig({ env: sampleEnv({ OPENAI_API_KEY: '   ' }) })).toThrow(/OPENAI_API_KEY/);
  });

  test('honours OPENAI_MODEL and PARSE_INTERVAL_MS', () => {
    const config = loadConfig({ env: sampleEnv({ OPENAI_MODEL: 'gpt-x', PARSE_INTERVAL_MS: '60000' }) });
    expect(config.openaiModel).toBe('gpt-x');
    expect(config.parseIntervalMs).toBe(60_000);
  });

  test('rejects a PARSE_INTERVAL_MS that is not a positive number', () => {
    expect(() => loadConfig({ env: sampleEnv({ PARSE_INTERVAL_MS: 'soon' }) })).toThrow(/PARSE_INTERVAL_MS/);
  });

  test('honours DRY_RUN', () => {
    expect(loadConfig({ env: sampleEnv({ DRY_RUN: '1' }) }).dryRun).toBe(true);
    expect(loadConfig({ env: sampleEnv({ DRY_RUN: '0' }) }).dryRun).toBe(false);
  });

  test('honours LOG_LEVEL', () => {
    expect(loadConfig({ env: sampleEnv({ LOG_LEVEL: 'debug' }) }).logLevel).toBe('debug');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test ./whatsapp/test/bridge.test.js -t loadConfig`
Expected: FAIL. `rejects a missing APPS_SCRIPT_URL`-style assertions are gone, and the new expectations (`databaseUrl`, `parseIntervalMs`) read `undefined`.

- [ ] **Step 3: Implement**

In `whatsapp/src/config.js`, replace `loadConfig` and its docstring. Keep `requireEnv` and `optionalEnv`, and add this helper above `loadConfig`:

```js
/**
 * Reads an optional positive integer, in milliseconds.
 *
 * @param {!Object<string, string>} env The environment to read from.
 * @param {string} key Name of the variable.
 * @param {number} fallback Value when the variable is absent or blank.
 * @returns {number} The parsed value, or the fallback.
 * @throws {Error} If the variable is set but is not a positive integer.
 */
function optionalPositiveInt(env, key, fallback) {
  const raw = optionalEnv(env, key, '');
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive whole number of milliseconds, got "${raw}".`);
  }
  return value;
}

/**
 * Builds the whole configuration, validating it up front.
 *
 * Loading fails fast at start-up rather than at the moment the first parade
 * state arrives.
 *
 * `env` is injectable because Bun has already merged .env into `process.env`
 * before this module runs, which a test cannot undo — without it, a populated
 * .env on the developer's machine silently overrides whatever the test set.
 *
 * `DATABASE_URL` is read here only to fail fast. `db/index.ts` reads it again
 * from `process.env` when the first query runs.
 *
 * @param {{env?: !Object<string, string>}} [options] `env` defaults to
 *   process.env, which already carries whatsapp/.env.
 * @returns {{groupId: string, databaseUrl: string, openaiApiKey: string,
 *   openaiModel: (string|undefined), parseIntervalMs: number, logLevel: string,
 *   dryRun: boolean, authDir: string}} The resolved configuration.
 * @throws {Error} If a required variable is missing or a value is malformed.
 */
export function loadConfig(options = {}) {
  const env = options.env || process.env;

  return {
    groupId: requireEnv(env, 'WA_GROUP_ID'),
    databaseUrl: requireEnv(env, 'DATABASE_URL'),
    openaiApiKey: requireEnv(env, 'OPENAI_API_KEY'),
    openaiModel: optionalEnv(env, 'OPENAI_MODEL', '') || undefined,
    parseIntervalMs: optionalPositiveInt(env, 'PARSE_INTERVAL_MS', 300_000),
    logLevel: optionalEnv(env, 'LOG_LEVEL', 'info'),
    dryRun: optionalEnv(env, 'DRY_RUN', '0') === '1',
    authDir: AUTH_DIR,
  };
}
```

Replace the `# --- Apps Script web app` section of `whatsapp/.env.example` with:

```
# --- Neon -------------------------------------------------------------------
# Connection string for the parade_ingest role (db/grants-ingest.sql), NOT the
# owner. That role can store and parse parade states and nothing else.
DATABASE_URL=

# --- Parser -----------------------------------------------------------------
OPENAI_API_KEY=
# Optional. Leave blank for lib/parser/extract.ts's default.
OPENAI_MODEL=

# How often to retry messages whose parse failed transiently, in ms. A new
# message is parsed as soon as it arrives; this only sweeps leftovers.
PARSE_INTERVAL_MS=300000
```

Also change the `DRY_RUN` comment to `# Set to 1 to log accepted messages instead of storing them.`

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `bun test ./whatsapp/test/bridge.test.js -t loadConfig`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add whatsapp/src/config.js whatsapp/test/bridge.test.js whatsapp/.env.example
git commit -m "feat(whatsapp): configure Neon and OpenAI instead of Apps Script"
```

---

### Task 3: Wire the handler to the ingestor, and delete the Apps Script relay

**Files:**
- Modify: `whatsapp/src/index.js` (`createMessageHandler`, `main`, header comment)
- Delete: `whatsapp/src/appsScriptClient.js`
- Modify: `whatsapp/test/bridge.test.js` (drop the `appsScriptClient` import, `describe('appsScriptClient helpers')`, `describe('relayParadeState')`, `EXEC_URL`; rewrite `describe('createMessageHandler')`)
- Modify: `whatsapp/package.json` (`description`)

**Interfaces:**
- Consumes: `createIngestor` (Task 1), `loadConfig` (Task 2), `getDb()` from `db/index.ts`.
- Produces: `createMessageHandler({ config, logger, ingestor }) → (text, envelope) => Promise<void>`.

- [ ] **Step 1: Rewrite the handler tests**

Replace `describe('createMessageHandler', ...)` in `whatsapp/test/bridge.test.js`. Keep the `PARADE_STATE` constant, and remove the `beforeEach`/`afterEach` fetch stubbing:

```js
describe('createMessageHandler', () => {
  // The existing `/** @type {string} */ const PARADE_STATE = [...]` declaration stays here
  // exactly as it is today; only the blocks around it change.

  /**
   * An ingestor that records what it was given.
   *
   * @param {function(): !Promise<Object>=} impl Replaces the default outcome.
   * @returns {{calls: !Array<!Array<string>>, ingest: function(string, string): !Promise<Object>}}
   */
  function fakeIngestor(impl = async () => ({ status: 'stored', id: 1 })) {
    const calls = [];
    return {
      calls,
      ingest: async (text, messageId) => {
        calls.push([text, messageId]);
        return impl();
      },
    };
  }

  test('ingests an accepted parade state with its message id', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });
    await handle(PARADE_STATE, { key: { id: 'MSG1' } });

    expect(ingestor.calls).toHaveLength(1);
    expect(ingestor.calls[0][1]).toBe('MSG1');
    expect(ingestor.calls[0][0]).toContain('PARADE STATE');
  });

  test('never ingests a rejected message', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });
    await handle('Why is your parade state late?', { key: { id: 'MSG2' } });

    expect(ingestor.calls).toHaveLength(0);
  });

  test('ingests nothing in DRY_RUN', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: true }, logger: silentLogger, ingestor });
    await handle(PARADE_STATE, { key: { id: 'MSG3' } });

    expect(ingestor.calls).toHaveLength(0);
  });

  test('swallows a storage failure so one bad message cannot stop the listener', async () => {
    const ingestor = fakeIngestor(async () => {
      throw new Error('neon unreachable');
    });
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });

    expect(await handle(PARADE_STATE, { key: { id: 'MSG4' } })).toBeUndefined();
  });
});
```

Delete the `appsScriptClient` import line, the `EXEC_URL` constant, `describe('appsScriptClient helpers', ...)` and `describe('relayParadeState', ...)`. Update the file's header comment so it no longer mentions the Apps Script client.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test ./whatsapp/test/bridge.test.js -t createMessageHandler`
Expected: FAIL. The current handler ignores `ingestor` and calls `fetch`.

- [ ] **Step 3: Implement**

Replace `whatsapp/src/index.js` with:

```js
/**
 * Entry point for the WhatsApp parade-state ingestor.
 *
 * Pipeline: WhatsApp group message -> first-parade check -> stored in Neon ->
 * parsed on this machine into parade-state rows. See ingest.js for why parsing
 * happens here and not on Vercel.
 */

import { getDb } from '../../db/index.ts';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createIngestor } from './ingest.js';
import { isParadeState } from './signature.js';
import { startListener } from './listener.js';

/**
 * Builds the handler invoked for every message in the watched group.
 *
 * There is no local record of what has already been stored. Dedup is the
 * `wa_message_id` unique constraint in Neon, so a resend after a restart is
 * harmless, and it is how a message whose parse never finished gets retried.
 *
 * @param {Object} deps Handler dependencies.
 * @param {Object} deps.config Resolved configuration from loadConfig().
 * @param {import('pino').Logger} deps.logger Logger for status output.
 * @param {{ingest: function(string, string): !Promise<Object>}} deps.ingestor
 *   From createIngestor().
 * @returns {function(string, Object): Promise<void>} The message handler.
 */
export function createMessageHandler({ config, logger, ingestor }) {
  return async function handleMessage(text, envelope) {
    const messageId = envelope.key?.id || '';
    const { accepted, rejectReason } = isParadeState(text);

    if (!accepted) {
      logger.debug({ messageId, reason: rejectReason }, 'ignored non-parade-state message');
      return;
    }

    const summary = { messageId, chars: text.length };

    if (config.dryRun) {
      logger.info(summary, 'DRY_RUN: parade state accepted but not stored');
      return;
    }

    try {
      const outcome = await ingestor.ingest(text, messageId);
      logger.info({ ...summary, status: outcome.status, id: outcome.id }, 'stored parade state');
    } catch (err) {
      logger.error({ ...summary, err: err.message }, 'store failed; will retry if the message is resent');
    }
  };
}

/**
 * Starts the ingestor.
 *
 * @returns {Promise<void>} Rejects when the WhatsApp session is unrecoverable.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const ingestor = createIngestor({
    db: getDb(),
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    logger,
  });

  logger.info({ groupId: config.groupId, dryRun: config.dryRun }, 'starting WhatsApp parade-state ingestor');

  // Anything stored but left unparsed by a previous crash is picked up now, and
  // transient failures (a model timeout) are swept on the interval. unref() so
  // the timer never keeps a dying process alive for the supervisor to wait on.
  if (!config.dryRun) {
    ingestor.drain();
    setInterval(() => ingestor.drain(), config.parseIntervalMs).unref();
  }

  await startListener({
    authDir: config.authDir,
    groupId: config.groupId,
    logger,
    onMessage: createMessageHandler({ config, logger, ingestor }),
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    // A fatal error (dead session, re-pair required) exits 3 so the supervisor
    // stops instead of restarting into the same wall; anything else exits 1 so
    // the supervisor recycles the process.
    process.exit(err && err.fatal ? 3 : 1);
  });
}
```

Delete the old relay:

```bash
git rm whatsapp/src/appsScriptClient.js
```

In `whatsapp/package.json`, set `"description"` to `"Watches a WhatsApp group for parade-state messages, stores them in Neon and parses them into rows."`

- [ ] **Step 4: Run the whole suite**

Run: `bun test ./test/ ./whatsapp/test/`
Expected: PASS, 0 fail. Then run `grep -rn "appsScript\|APPS_SCRIPT" whatsapp/src whatsapp/test whatsapp/.env.example`, which should print nothing.

- [ ] **Step 5: Commit**

```bash
git add -A whatsapp/src whatsapp/test whatsapp/package.json
git commit -m "feat(whatsapp): store and parse in Neon instead of relaying to Apps Script"
```

---

### Task 4: A least-privilege Neon role for the runner

**Files:**
- Create: `db/grants-ingest.sql`

**Interfaces:**
- Produces: the Postgres role `parade_ingest`. Its connection string becomes `DATABASE_URL` in `whatsapp/.env`.

This role is for a laptop, which is easier to lose than a Vercel project. Its grants are exactly what `recordMessage`, `parseDue`, `writeSubmission` and `markFailed` in `lib/pipeline.ts` run:

| Table | Statements in `lib/pipeline.ts` | Grant |
|---|---|---|
| `raw_messages` | INSERT … ON CONFLICT, SELECT, UPDATE, sub-select in the orphan sweep | SELECT, INSERT, UPDATE |
| `parade_submissions` | DELETE, INSERT | SELECT, INSERT, DELETE |
| `strength_rows`, `personnel_rows`, `command_roster_rows`, `section_counts` | INSERT (DELETE via cascade) | INSERT |

FormSG tables, `auth_failures` and the reference tables get nothing.

- [ ] **Step 1: Write the SQL**

`db/grants-ingest.sql`:

```sql
-- The role the local WhatsApp runner connects as.
--
-- The runner stores raw parade states and writes the rows parsed from them, through
-- lib/pipeline.ts and nothing else. It runs on a laptop, so its credential gets exactly the
-- statements that module issues, and no FormSG, dashboard or auth table.
--
-- Usage:
--   psql "$DATABASE_URL" -v ingest_password="$(openssl rand -base64 24)" -f db/grants-ingest.sql
-- then put that role's connection string in whatsapp/.env as DATABASE_URL.

\set ON_ERROR_STOP on

SELECT format('CREATE ROLE parade_ingest LOGIN PASSWORD %L', :'ingest_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parade_ingest')
\gexec

SELECT format('ALTER ROLE parade_ingest PASSWORD %L', :'ingest_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'parade_ingest')
\gexec

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO parade_ingest', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO parade_ingest;

GRANT SELECT, INSERT, UPDATE ON raw_messages TO parade_ingest;

GRANT SELECT, INSERT, DELETE ON parade_submissions TO parade_ingest;

GRANT INSERT ON
  strength_rows,
  personnel_rows,
  command_roster_rows,
  section_counts
TO parade_ingest;

-- Identity columns draw from sequences. Harmless if Postgres does not require it.
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO parade_ingest;

-- Verification, run as parade_ingest:
--   SELECT count(*) FROM raw_messages;          -- must SUCCEED
--   SELECT count(*) FROM formsg_submissions;    -- must FAIL: permission denied
```

- [ ] **Step 2: Apply it to Neon (manual, needs the owner URL)**

```bash
psql "$DATABASE_URL" -v ingest_password="$(openssl rand -base64 24)" -f db/grants-ingest.sql
```

Record the password in a password manager, not in the repo.

- [ ] **Step 3: Verify the grants**

Connect as `parade_ingest` and run both verification queries at the bottom of the file. Expected: the first returns a count, and the second fails with `permission denied for table formsg_submissions`.

- [ ] **Step 4: Commit**

```bash
git add db/grants-ingest.sql
git commit -m "feat(db): parade_ingest role for the local WhatsApp runner"
```

---

### Task 5: Live verification on the runner machine

No code. This is the gate before anything on Vercel is removed.

- [ ] **Step 1: Install and configure.** From the repo root run `bun install`, then run it again in `whatsapp/`. Copy `whatsapp/.env.example` to `whatsapp/.env` and fill in `WA_GROUP_ID`, `DATABASE_URL` (the `parade_ingest` URL) and `OPENAI_API_KEY`.
- [ ] **Step 2: Dry run.** Set `DRY_RUN=1` and run `bun start` in `whatsapp/`. Post a real parade state in the group. Expected log: `DRY_RUN: parade state accepted but not stored`, and no new row in `raw_messages`.
- [ ] **Step 3: Live run.** Set `DRY_RUN=0` and restart. Post a parade state. Expected, in order: `stored parade state` with `status: "stored"`, then about 75–130 s later `parse run finished` with `parsed: 1`. In Neon, `raw_messages.processed_at` is set and `parade_submissions` has the new `parade_response_id` with child rows.
- [ ] **Step 4: Crash recovery.** Post a parade state and kill the process within 30 s. Restart it. Expected: the start-up drain logs `parse run finished` with `parsed: 1`, and the message is not stored twice.
- [ ] **Step 5: Dashboard.** Open https://40sar.vercel.app and confirm the new parade state appears. This depends on the dashboard reading from Neon; see `todo2.md`.

---

### Task 6: Retire the Vercel intake routes

**Only after Task 5 passes.**

**Files:**
- Delete: `api/whatsapp.ts`, `api/parse-due.ts`, `test/api/whatsapp.test.ts`, `test/api/parse-due.test.ts`
- Modify: `.env.example`, which loses `WHATSAPP_INGEST_TOKEN`, `CRON_SECRET` and `OPENAI_API_KEY`, the last because nothing on Vercel calls the model any more
- Modify: `lib/pipeline.ts` header comment
- Modify: `lib/http.ts`, but only if `requireBearer` or `readJson` become unused; check with `grep -rn "requireBearer\|readJson" api lib`

- [ ] **Step 1: Delete the routes and their tests**

```bash
git rm api/whatsapp.ts api/parse-due.ts test/api/whatsapp.test.ts test/api/parse-due.test.ts
```

- [ ] **Step 2: Update the `lib/pipeline.ts` header.** Replace its first two paragraphs with:

```ts
/**
 * The one implementation of extract -> validate -> replace.
 *
 * The local WhatsApp runner (`whatsapp/src/ingest.js`) is the only caller: it records each
 * message with `recordMessage` and drains with `parseDue`, so there is exactly one code path
 * that writes parade-state rows and exactly one place a rule about them can live.
 *
 * Intake and parsing are split because the model is slow. A real message took 74 seconds
 * against the flex tier, and the messiest took 126. So `recordMessage` returns the moment
 * the text is safely stored, and the parse runs behind it. A slow model then delays a row;
 * it never loses one.
 */
```

- [ ] **Step 3: Update `.env.example`.** Delete the `# --- Parade-state intake` and `# --- Parser` sections. What remains is Database, FormSG and Dashboard.

- [ ] **Step 4: Run the full suite and the build**

Run: `bun test ./test/ ./whatsapp/test/` and then `bun run build`.
Expected: both pass, and `grep -rn "parse-due\|api/whatsapp\|WHATSAPP_INGEST_TOKEN\|CRON_SECRET" --include=*.ts --include=*.js --include=*.json . | grep -v node_modules` prints nothing.

- [ ] **Step 5: Commit, then deploy**

```bash
git add -A api test/api .env.example lib/pipeline.ts
git commit -m "refactor: retire the Vercel parade-state intake; the runner parses locally"
```

Push to `main`. After the production deploy is Ready, remove `WHATSAPP_INGEST_TOKEN` and `CRON_SECRET` from Vercel if they were ever added (`vercel env rm <NAME> production`).

---

### Task 7: Documentation

**Files:**
- Modify: `docs/architecture_patterns.md` (sections "Three independent intakes" and "Three ways into the parade-state pipeline")
- Modify: `whatsapp/README.md` (setup and environment sections)

- [ ] **Step 1: Rewrite the intake table in `docs/architecture_patterns.md`**

```markdown
| Pipeline | Entry point | Lands in |
|---|---|---|
| Parade state (AI) | `whatsapp/src/index.js` — long-running Bun process on the ops laptop; parses via `lib/pipeline.ts` | `raw_messages` → `parade_submissions`, `strength_rows`, `personnel_rows`, `command_roster_rows`, `section_counts` |
| Report sick (FormSG) | `api/formsg.ts` — Vercel Function, FormSG webhook | `formsg_submissions`, `formsg_statuses` |
```

Replace "Three ways into the parade-state pipeline" with one paragraph. It should say that the runner stores through `recordMessage` and parses through `parseDue`, and that parsing is single-flight. It should also say why parsing is local: the 74–126 s extraction, Hobby's 60 s cap, and Hobby refusing sub-daily crons. Finally, it should say that the runner connects as `parade_ingest` (`db/grants-ingest.sql`). Keep the supervisor paragraph as it is.

- [ ] **Step 2: Update `whatsapp/README.md`.** Replace every Apps Script setup step with: root `bun install`; `whatsapp/.env` with `DATABASE_URL` (the `parade_ingest` role), `OPENAI_API_KEY` and optional `OPENAI_MODEL`/`PARSE_INTERVAL_MS`; and `bun start`.

- [ ] **Step 3: Check for stale references**

Run: `grep -rn "Apps Script\|appsScript\|parse-due" docs/architecture_patterns.md whatsapp/README.md`
Expected: only historical mentions that are clearly marked as history.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture_patterns.md whatsapp/README.md
git commit -m "docs: parade-state parsing runs in the local WhatsApp runner"
```
