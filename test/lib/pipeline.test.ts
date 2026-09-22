/**
 * The parse run: which parser handles a message, and the backlog accounting (`skipped`),
 * which the WhatsApp drain loop reads to decide whether to go round again.
 */
import { describe, expect, test } from 'bun:test';
import { parseDue } from '../../lib/pipeline.ts';

/** A message as the drain selects it. */
interface DueRow {
  id: number;
  waMessageId: string;
  body: string;
}

/**
 * Builds a fake Drizzle handle over a fixed set of due messages.
 *
 * It mimics only the two queries `parseDue` issues, told apart by whether `limit` was called:
 * the backlog count, and the page of work.
 *
 * @param due The unprocessed messages.
 * @returns The fake handle.
 */
function fakeDb(due: DueRow[]): any {
  return {
    select() {
      let limit: number | null = null;
      const builder: any = {
        from: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit(n: number) {
          limit = n;
          return builder;
        },
        then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
          const value = limit === null ? [{ n: due.length }] : due.slice(0, limit);
          return Promise.resolve(value).then(resolve, reject);
        },
      };
      return builder;
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: () => ({}) }),
    insert: () => ({ values: () => ({}) }),
    batch: async () => undefined,
  };
}

/**
 * Builds n due messages.
 *
 * @param n How many.
 * @returns The messages.
 */
function messages(n: number): DueRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    waMessageId: `wa-${i + 1}`,
    body: 'PARADE STATE',
  }));
}

/** A fetch that always fails, so every extraction is a transient failure left unprocessed. */
const offline = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

describe('skipped', () => {
  test('counts what lay beyond the batch limit', async () => {
    const run = await parseDue(fakeDb(messages(7)), { apiKey: 'unused', limit: 5, fetchImpl: offline });

    // Five attempted (and failed transiently), two never looked at.
    expect(run.results.map((r) => r.outcome)).toEqual(Array(5).fill('failed'));
    expect(run.skipped).toBe(2);
  });

  test('is zero for an empty queue', async () => {
    const run = await parseDue(fakeDb([]), { apiKey: 'unused' });
    expect(run).toEqual({ results: [], skipped: 0 });
  });
});

describe('parser choice', () => {
  test('a template message is parsed without calling the model', async () => {
    const body = [
      '40 SAR BRAVES COMPANY',
      'FIRST PARADE STATE',
      'DATE: 180926 TIME: 0700',
      'COMPANY: 10/12',
      'ATT C: 1',
      '1. 1101 REC TAN AH KOW - 2D MC (170926-180926)',
    ].join('\n');
    const due = [{ id: 1, waMessageId: 'wa-1', body }];
    const run = await parseDue(fakeDb(due), { apiKey: 'unused', fetchImpl: offline });

    // `offline` throws, so reaching the model would have made this 'failed'.
    expect(run.results[0]).toMatchObject({ outcome: 'parsed', parser: 'deterministic', counts: { personnel: 1 } });
  });

  test('a message the template parser doubts goes to the model', async () => {
    const run = await parseDue(fakeDb(messages(1)), { apiKey: 'unused', fetchImpl: offline });
    expect(run.results[0]!.outcome).toBe('failed');
    expect(run.results[0]!.reason).toContain('offline');
  });
});
