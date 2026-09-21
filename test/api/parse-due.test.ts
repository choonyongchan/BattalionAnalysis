/**
 * The cron drain route.
 *
 * Two things here are worth guarding. The route must pass a real deadline down to the
 * pipeline -- without one, a backlog runs until the platform kills the function and the
 * extraction in flight is paid for and thrown away. And the response must summarise rather
 * than enumerate: it goes to a scheduler's log, which is not a place to put the message ids
 * and rejection reasons of real parade states.
 */
import { describe, expect, test } from 'bun:test';
import { handle, maxDuration, type Deps } from '../../api/parse-due.ts';
import type { ParseOptions, ParseRun } from '../../lib/pipeline.ts';

const SECRET = 'cron-secret-for-tests';

/** An empty run, for tests that care only about the request half. */
const NOTHING_DUE: ParseRun = { results: [], skipped: 0, stoppedEarly: false };

/**
 * Builds deps whose `parse` seam records the options it was given.
 *
 * @param run What the fake pipeline should report.
 * @param clock A fake clock, so elapsed time is deterministic.
 * @returns The deps, plus the captured options.
 */
function deps(
  run: ParseRun = NOTHING_DUE,
  clock?: () => number,
): { deps: Deps; seen: ParseOptions[] } {
  const seen: ParseOptions[] = [];
  return {
    seen,
    deps: {
      db: {},
      secret: SECRET,
      apiKey: 'sk-test',
      model: 'gpt-5.6-luna',
      clock,
      parse: async (_db, options) => {
        seen.push(options);
        return run;
      },
    },
  };
}

/**
 * Builds a request to the route.
 *
 * @param options Method and token overrides.
 * @returns The request.
 */
function call(options: { method?: string; token?: string | null } = {}): Request {
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? SECRET : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request('https://example.test/api/parse-due', {
    method: options.method ?? 'GET',
    headers,
  });
}

describe('method and authorisation', () => {
  test('accepts GET, which is what Vercel Cron issues', async () => {
    expect((await handle(call({ method: 'GET' }), deps().deps)).status).toBe(200);
  });

  test('accepts POST, so the drain can be kicked by hand', async () => {
    expect((await handle(call({ method: 'POST' }), deps().deps)).status).toBe(200);
  });

  test('rejects other methods', async () => {
    const response = await handle(call({ method: 'DELETE' }), deps().deps);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
  });

  test('refuses a wrong or missing secret without parsing anything', async () => {
    const harness = deps();
    expect((await handle(call({ token: 'wrong' }), harness.deps)).status).toBe(401);
    expect((await handle(call({ token: null }), harness.deps)).status).toBe(401);
    expect(harness.seen).toEqual([]);
  });

  test('fails closed when CRON_SECRET is unset', async () => {
    const harness = deps();
    const response = await handle(call(), { ...harness.deps, secret: undefined });
    expect(response.status).toBe(503);
    expect(harness.seen).toEqual([]);
  });

  test('refuses to run without an API key rather than failing message by message', async () => {
    // Every message would fail identically and each failure is recorded permanently against
    // the row, so a misconfigured key would burn the whole backlog. Better to do nothing.
    const harness = deps();
    const response = await handle(call(), { ...harness.deps, apiKey: undefined });
    expect(response.status).toBe(503);
    expect(harness.seen).toEqual([]);
  });
});

describe('the time budget', () => {
  test('passes a deadline inside the platform timeout', async () => {
    const harness = deps(NOTHING_DUE, () => 1_000_000);
    await handle(call(), harness.deps);

    const options = harness.seen[0]!;
    expect(options.deadline).toBeDefined();
    // Strictly inside the window the platform allows, with room for the last write.
    expect(options.deadline!).toBeGreaterThan(1_000_000);
    expect(options.deadline!).toBeLessThan(1_000_000 + maxDuration * 1000);
  });

  test('passes its own clock down, so the pipeline and the route agree on the time', async () => {
    const harness = deps(NOTHING_DUE, () => 5_000);
    await handle(call(), harness.deps);
    expect(harness.seen[0]!.clock!()).toBe(5_000);
  });

  test('caps how many messages one run will start', async () => {
    // A limit as well as a deadline: the limit bounds the query that selects work, the
    // deadline bounds the work itself. Neither alone is enough.
    const harness = deps();
    await handle(call(), harness.deps);
    expect(harness.seen[0]!.limit).toBeGreaterThan(0);
  });

  test('forwards the configured model', async () => {
    const harness = deps();
    await handle(call(), harness.deps);
    expect(harness.seen[0]!.model).toBe('gpt-5.6-luna');
  });
});

describe('the summary', () => {
  test('counts outcomes and reports the backlog it left', async () => {
    let time = 1_000;
    const harness = deps(
      {
        results: [
          { id: 1, waMessageId: 'wa-1', outcome: 'parsed', paradeResponseId: 'Archer_2026-09-18_FPS' },
          { id: 2, waMessageId: 'wa-2', outcome: 'rejected', reason: 'Last Parade State.' },
          { id: 3, waMessageId: 'wa-3', outcome: 'failed', reason: 'boom' },
        ],
        skipped: 4,
        stoppedEarly: true,
      },
      () => (time += 500),
    );

    const response = await handle(call(), harness.deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      parsed: 1,
      rejected: 1,
      failed: 1,
      skipped: 4,
      stoppedEarly: true,
    });
  });

  test('puts no message id or rejection reason on the wire', async () => {
    /*
     * The response is read by a scheduler's log. A `wa_message_id` identifies a real group
     * message and a rejection reason quotes the parade state, so the counts go out and the
     * detail stays in the database for whoever investigates.
     */
    const harness = deps({
      results: [{ id: 2, waMessageId: 'wa-secret-id', outcome: 'rejected', reason: 'ARCHER COY' }],
      skipped: 0,
      stoppedEarly: false,
    });

    const text = await (await handle(call(), harness.deps)).text();
    expect(text).not.toContain('wa-secret-id');
    expect(text).not.toContain('ARCHER COY');
  });

  test('an unexpected throw is a 500 with a reference, not a stack trace', async () => {
    const response = await handle(call(), {
      db: {},
      secret: SECRET,
      apiKey: 'sk-test',
      parse: async () => {
        throw new Error('connection refused to ep-flat-wildflower');
      },
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { reference: string };
    expect(body.reference).toMatch(/^[a-z0-9]+$/);
    expect(JSON.stringify(body)).not.toContain('ep-flat-wildflower');
  });
});
