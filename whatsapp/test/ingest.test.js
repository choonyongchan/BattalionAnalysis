/**
 * Tests for the ingestor: storing a message, and draining the parse queue one
 * run at a time. The database and the model are both faked, since lib/pipeline.ts
 * has its own tests. What is under test here is the scheduling around it.
 */

import { describe, expect, test } from 'bun:test';
import { createIngestor, tallyRun } from '../src/ingest.js';
import { DrizzleQueryError } from '../../node_modules/drizzle-orm/errors.js';

/** @type {string} A marker standing in for a name/NRIC that must never reach a log. */
const MARKER = 'NRIC S1234568B BODY';

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
    expect(errors[0].err).toEqual({ name: 'Error', message: 'neon unreachable' });
  });

  test('never logs a DrizzleQueryError message or params from a failed run', async () => {
    const errors = [];
    const ingestor = createIngestor({
      db: 'DB',
      apiKey: 'k',
      logger: { ...silentLogger, error: (fields) => errors.push(fields) },
      parse: async () => {
        throw new DrizzleQueryError('update raw_messages set error = $1', [MARKER], new Error('fetch failed'));
      },
    });

    await ingestor.drain();

    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).not.toContain(MARKER);
  });
});
