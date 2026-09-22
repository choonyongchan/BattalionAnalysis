/**
 * Tests for the relay to `api/parade.ts`: what it sends, which answers are final, and which
 * failures it retries.
 */

import { describe, expect, test } from 'bun:test';
import { RelayError, createIngestor } from '../../whatsapp/src/ingest.js';

/** @type {string} The intake URL used throughout. */
const URL = 'https://example.vercel.app/api/parade';

/**
 * A fetch that answers from a script, one entry per call, recording each request.
 *
 * @param {!Array<(!Response|!Error)>} script What each successive call returns or throws.
 * @returns {{calls: !Array<{url: string, init: !Object}>, fetchImpl: typeof fetch}} The fake.
 */
function scriptedFetch(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = script[Math.min(calls.length - 1, script.length - 1)];
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

/**
 * A JSON response.
 *
 * @param {number} status The status code.
 * @param {!Object} body The JSON body.
 * @returns {!Response} The response.
 */
function answer(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/**
 * Builds a relay over a scripted fetch, with sleeps recorded instead of waited.
 *
 * @param {!Array<(!Response|!Error)>} script What each call returns or throws.
 * @returns {{relay: !Object, calls: !Array<!Object>, sleeps: !Array<number>}} The relay and its records.
 */
function relayOver(script) {
  const { calls, fetchImpl } = scriptedFetch(script);
  const sleeps = [];
  const relay = createIngestor({ url: URL, secret: 's3cret', fetchImpl, sleep: async (ms) => sleeps.push(ms) });
  return { relay, calls, sleeps };
}

describe('createIngestor.ingest', () => {
  test('posts the text under its WhatsApp id with the bearer secret', async () => {
    const { relay, calls } = relayOver([answer(200, { status: 'parsed', id: 1 })]);

    await relay.ingest('PARADE STATE', 'MSG1');

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers.Authorization).toBe('Bearer s3cret');
    expect(JSON.parse(calls[0].init.body)).toEqual({ waMessageId: 'MSG1', body: 'PARADE STATE' });
  });

  test('returns a 422 answer as final, without retrying', async () => {
    const { relay, calls } = relayOver([answer(422, { status: 'needs_review', id: 2, problems: ['x'] })]);

    expect(await relay.ingest('PARADE STATE', 'MSG2')).toMatchObject({ status: 'needs_review', id: 2 });
    expect(calls).toHaveLength(1);
  });

  test('retries a 5xx and a network failure, backing off, then returns the answer', async () => {
    const { relay, calls, sleeps } = relayOver([
      answer(503, { error: 'down' }),
      new TypeError('fetch failed'),
      answer(200, { status: 'parsed', id: 3 }),
    ]);

    expect(await relay.ingest('PARADE STATE', 'MSG3')).toMatchObject({ status: 'parsed' });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2_000, 4_000]);
  });

  test('gives up after three failed attempts', async () => {
    const { relay, calls } = relayOver([answer(500, { error: 'boom' })]);

    await expect(relay.ingest('PARADE STATE', 'MSG4')).rejects.toBeInstanceOf(RelayError);
    expect(calls).toHaveLength(3);
  });

  test('does not retry a 401, which only a configuration change can fix', async () => {
    const { relay, calls } = relayOver([answer(401, { error: 'Not authorised.' })]);

    await expect(relay.ingest('PARADE STATE', 'MSG5')).rejects.toThrow(/401/);
    expect(calls).toHaveLength(1);
  });

  test('never puts the message text in the error', async () => {
    const { relay } = relayOver([new TypeError('fetch failed')]);

    await expect(relay.ingest('NRIC S1234568B BODY', 'MSG6')).rejects.not.toThrow(/S1234568B/);
  });
});
