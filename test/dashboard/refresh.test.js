/**
 * `refresh()` never runs two reads at once, and a call made mid-read is not dropped: it
 * queues one follow-up read, so a save made during a background refresh is still seen.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { refresh } from '../../src/app/auth.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * Replaces `fetch` with one whose replies the test releases by hand.
 *
 * Each reply is a 503, so the read fails quietly and leaves the page as it is.
 * @returns {{calls: function(): number, release: function(): void}} The call count and a
 *     function that answers the oldest pending call.
 */
function heldFetch() {
  const pending = [];
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return new Promise((resolve) => pending.push(resolve));
  };
  return {
    calls: () => calls,
    release: () => pending.shift()(new Response('{}', { status: 503 })),
  };
}

/**
 * Lets queued promise callbacks run.
 * @returns {!Promise<void>} Resolves on a later macrotask.
 */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('refresh', () => {
  test('calls made mid-read share one follow-up read, started after the first', async () => {
    const fetch = heldFetch();
    let done = 0;
    const first = refresh().then(() => (done += 1));
    const second = refresh().then(() => (done += 1));
    const third = refresh().then(() => (done += 1));
    await settle();
    expect(fetch.calls()).toBe(1);

    fetch.release();
    await first;
    await settle();
    expect(fetch.calls()).toBe(2);
    expect(done).toBe(1);

    fetch.release();
    await Promise.all([second, third]);
    expect(done).toBe(3);
    expect(fetch.calls()).toBe(2);
  });

  test('a call with nothing in flight reads at once', async () => {
    const fetch = heldFetch();
    const read = refresh();
    await settle();
    expect(fetch.calls()).toBe(1);
    fetch.release();
    expect(await read).toBe(false);
  });
});
