/**
 * The parse run's time budget and backlog accounting.
 *
 * Extraction itself is covered by `parser-extract.test.ts` and `parser-rows.test.ts`. What is
 * tested here is the part that only matters under a platform timeout: a run must stop before
 * it is killed, and it must report honestly what it did not reach, or a backlog looks like an
 * empty queue.
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

describe('the deadline', () => {
  test('starts nothing once the deadline has passed', async () => {
    /*
     * The model is never called, so this passes with a nonsense API key. That is the
     * assertion: a run out of time must not begin an extraction it cannot finish, because
     * the extraction is billed whether or not its result is used.
     */
    const run = await parseDue(fakeDb(messages(3)), {
      apiKey: 'unused',
      deadline: 1_000,
      clock: () => 2_000,
    });

    expect(run.results).toEqual([]);
    expect(run.stoppedEarly).toBe(true);
  });

  test('reports everything it did not reach as skipped', async () => {
    const run = await parseDue(fakeDb(messages(7)), {
      apiKey: 'unused',
      limit: 5,
      deadline: 1_000,
      clock: () => 2_000,
    });

    // All seven are still due: the five it selected and the two beyond the limit.
    expect(run.skipped).toBe(7);
  });

  test('does not stop early when there is no deadline', async () => {
    const run = await parseDue(fakeDb([]), { apiKey: 'unused' });
    expect(run.stoppedEarly).toBe(false);
    expect(run.skipped).toBe(0);
  });

  test('an empty queue is not an early stop', async () => {
    // The two must stay distinguishable: "nothing to do" and "no time left" call for
    // different reactions from whoever is watching the schedule.
    const run = await parseDue(fakeDb([]), {
      apiKey: 'unused',
      deadline: 9_999,
      clock: () => 1_000,
    });
    expect(run.results).toEqual([]);
    expect(run.stoppedEarly).toBe(false);
  });
});
