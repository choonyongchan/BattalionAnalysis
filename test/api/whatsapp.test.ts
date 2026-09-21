/**
 * The parade-state intake route.
 *
 * The one behaviour worth more than the rest: this route must never call the model. A real
 * extraction takes 74-126 seconds, so a route that parsed inline would time out and the
 * bridge could not tell a lost message from a slow one. The tests below assert the whole
 * contract that follows from that -- 202 rather than 200, a duplicate that is still a
 * success, and validation that refuses rather than stores.
 */
import { describe, expect, test } from 'bun:test';
import { handle, type Deps } from '../../api/whatsapp.ts';
import type { RecordOutcome } from '../../lib/pipeline.ts';

const TOKEN = 'ingest-token-for-tests';

/** One call as the route made it, captured for assertions. */
interface Captured {
  waMessageId: string;
  body: string;
  source?: string;
}

/**
 * Builds deps whose `record` seam captures its arguments instead of touching a database.
 *
 * @param outcome What the fake recorder should report.
 * @returns The deps, plus the list it records into.
 */
function deps(outcome: RecordOutcome = { status: 'stored', id: 1 }): {
  deps: Deps;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    deps: {
      db: {},
      token: TOKEN,
      record: async (_db, message) => {
        calls.push(message as Captured);
        return outcome;
      },
    },
  };
}

/**
 * Builds a request to the route.
 *
 * @param body The JSON body, or a raw string to send verbatim.
 * @param options Method and token overrides.
 * @returns The request.
 */
function post(
  body: unknown,
  options: { method?: string; token?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return new Request('https://example.test/api/whatsapp', {
    method: options.method ?? 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('method and authorisation', () => {
  test('rejects anything but POST', async () => {
    const response = await handle(post({}, { method: 'GET' }), deps().deps);
    expect(response.status).toBe(405);
  });

  test('rejects a missing or wrong token before reading the body', async () => {
    const harness = deps();
    expect((await handle(post({ messageId: 'a', text: 'b' }, { token: null }), harness.deps)).status)
      .toBe(401);
    expect((await handle(post({ messageId: 'a', text: 'b' }, { token: 'wrong' }), harness.deps)).status)
      .toBe(401);
    // Nothing was stored on either attempt.
    expect(harness.calls).toEqual([]);
  });

  test('fails closed when the token is not configured', async () => {
    const response = await handle(post({ messageId: 'a', text: 'b' }), {
      db: {},
      token: undefined,
      record: async () => ({ status: 'stored', id: 1 }),
    });
    expect(response.status).toBe(503);
  });
});

describe('validation', () => {
  test('refuses a body that is not JSON', async () => {
    expect((await handle(post('{broken'), deps().deps)).status).toBe(400);
  });

  test('refuses a missing messageId or blank text', async () => {
    const harness = deps();
    expect((await handle(post({ text: 'hello' }), harness.deps)).status).toBe(400);
    expect((await handle(post({ messageId: 'a', text: '   ' }), harness.deps)).status).toBe(400);
    expect((await handle(post({ messageId: '  ', text: 'x' }), harness.deps)).status).toBe(400);
    expect(harness.calls).toEqual([]);
  });

  test('refuses an oversized body with 413 rather than truncating it', async () => {
    // Truncating would store a parade state missing its last platoons, which parses cleanly
    // and is wrong. Refusing is the only honest option.
    const harness = deps();
    const response = await handle(post({ messageId: 'a', text: 'x'.repeat(64_001) }), harness.deps);
    expect(response.status).toBe(413);
    expect(harness.calls).toEqual([]);
  });

  test('ignores an unknown source rather than trusting it', async () => {
    const harness = deps();
    await handle(post({ messageId: 'a', text: 'x', source: 'spoofed' }), harness.deps);
    expect(harness.calls[0]!.source).toBe('whatsapp');
  });

  test('honours the manual source, which is how a hand deposit stays auditable', async () => {
    const harness = deps();
    await handle(post({ messageId: 'a', text: 'x', source: 'manual' }), harness.deps);
    expect(harness.calls[0]!.source).toBe('manual');
  });
});

describe('outcomes', () => {
  test('answers 202, not 200 -- the message is stored, the rows do not exist yet', async () => {
    const response = await handle(post({ messageId: 'wa-1', text: 'PARADE STATE' }), deps().deps);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'stored', id: 1 });
  });

  test('passes the message through unaltered', async () => {
    const harness = deps();
    await handle(post({ messageId: 'wa-1', text: '  ARCHER FPS  ' }), harness.deps);
    // Cleaning belongs to the pipeline, which has one definition of it; the route must not
    // acquire a second.
    expect(harness.calls[0]).toMatchObject({ waMessageId: 'wa-1', body: '  ARCHER FPS  ' });
  });

  test('a duplicate is a 202, because a resend is a correct thing for the bridge to do', async () => {
    const response = await handle(
      post({ messageId: 'wa-1', text: 'x' }),
      deps({ status: 'duplicate', id: 7 }).deps,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'duplicate', id: 7 });
  });

  test('an already-parsed message reports its verdict, so a restart learns immediately', async () => {
    /*
     * Without this the bridge would resend after a restart and wait for a cron run that will
     * never look at the message again, because it is already processed.
     */
    const response = await handle(
      post({ messageId: 'wa-1', text: 'x' }),
      deps({
        status: 'already_processed',
        id: 7,
        paradeResponseId: null,
        error: 'This is a Last Parade State.',
      }).deps,
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      status: 'already_processed',
      id: 7,
      paradeResponseId: null,
      error: 'This is a Last Parade State.',
    });
  });

  test('a database failure is a 500 that carries a reference but no detail', async () => {
    // The thrown message quotes the row it failed on, and for this application that is
    // personnel data. It belongs in the log, not the response.
    const response = await handle(post({ messageId: 'a', text: 'x' }), {
      db: {},
      token: TOKEN,
      record: async () => {
        throw new Error('insert failed: duplicate name TAN AH KOW');
      },
    });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { reference: string };
    expect(body.reference).toMatch(/^[a-z0-9]+$/);
    expect(JSON.stringify(body)).not.toContain('TAN AH KOW');
  });
});
