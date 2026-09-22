/**
 * The write path: how a text parses, and what ingest, edit and delete write for each outcome.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { describe, expect, test } from 'bun:test';
import { parseParadeState } from '../../lib/parser/deterministic.ts';
import type { Extraction } from '../../lib/parser/extraction.ts';
import { deleteMessage, editMessage, ingestMessage, parseBody, type ModelParser } from '../../lib/pipeline.ts';

const NOW = new Date('2026-09-18T00:00:00Z');

/** A minimal template message the rule-based parser reads without doubt. */
const GOOD = `40 SAR ARCHER COMPANY
FIRST PARADE STATE
DATE: 180926 TIME: 0725
CDO: 2LT TAN AH KOW
================================
COMPANY: 10/10
================================
PL 1: 10/10
ATT C: 0
STATUS: 1
1. 1212 REC CHUA AH TECK - 84D EXCUSE STAY IN (250726-161026)
REPORT SICK: 0
MA: 0
OFF/LEAVE: 0
OTHERS: 0`;

/** The same message with a line the parser cannot place. */
const DOUBTFUL = GOOD.replace('84D EXCUSE STAY IN', 'SOMETHING UNHEARD OF');

/** A last parade state, which is rejected outright. */
const LAST = GOOD.replace('FIRST PARADE STATE', 'LAST PARADE STATE');

/** What a fake query resolves to, keyed by the kind of query. */
interface Answers {
  inserted?: Array<{ id: number }>;
  selected?: unknown[];
}

/**
 * Builds a fake Drizzle handle that records every write and answers reads from `answers`.
 *
 * @param answers What inserts' `returning` and selects resolve to.
 * @returns The handle and its records.
 */
function fakeDb(answers: Answers = {}) {
  const updates: Array<Record<string, unknown>> = [];
  const batches: unknown[][] = [];
  const thenable = (value: unknown) => ({
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  });
  const db = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: async () => answers.inserted ?? [] }),
      }),
    }),
    select: () => {
      const builder: any = { from: () => builder, where: () => builder, orderBy: () => builder, ...thenable(answers.selected ?? []) };
      return builder;
    },
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return { where: () => thenable(undefined) };
      },
    }),
    delete: () => ({ where: () => ({}) }),
    batch: async (statements: unknown[]) => {
      batches.push(statements);
    },
  };
  return { db, updates, batches };
}

/**
 * Builds a fake model fallback that answers with `answer`, or fails when it is an Error.
 *
 * @param answer The extraction to return, or the error to throw.
 * @returns The fake and the texts it was asked to read.
 */
function fakeModel(answer: Extraction | Error) {
  const calls: string[] = [];
  const model: ModelParser = {
    model: 'gpt-test',
    parse: async (text) => {
      calls.push(text);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { model, calls };
}

describe('parseBody', () => {
  test('a template message parses to its natural key', async () => {
    expect(await parseBody(GOOD, '2026-09-18')).toMatchObject({
      status: 'parsed',
      paradeResponseId: 'Archer_2026-09-18_FPS',
      parser: 'deterministic',
    });
  });

  test('a line the parser doubts needs review, with the reason', async () => {
    const parsed = await parseBody(DOUBTFUL, '2026-09-18');
    expect(parsed.status).toBe('needs_review');
    expect(parsed.status === 'needs_review' && parsed.problems.join()).toContain('SOMETHING UNHEARD OF');
  });

  test('a last parade state is rejected', async () => {
    expect((await parseBody(LAST, '2026-09-18')).status).toBe('rejected');
  });

  test('the model is not asked when the rules are sure', async () => {
    const { model, calls } = fakeModel(new Error('should not be called'));
    expect((await parseBody(GOOD, '2026-09-18', model)).status).toBe('parsed');
    expect(calls).toEqual([]);
  });

  test('a doubtful message is read by the model, and the rows say so', async () => {
    const { model, calls } = fakeModel(parseParadeState(GOOD, '2026-09-18').extraction);
    expect(await parseBody(DOUBTFUL, '2026-09-18', model)).toMatchObject({
      status: 'parsed',
      paradeResponseId: 'Archer_2026-09-18_FPS',
      parser: 'gpt-test',
    });
    expect(calls).toEqual([DOUBTFUL]);
  });

  test('a failed model call leaves the message for review, with both reasons', async () => {
    const { model } = fakeModel(new Error('Model API returned HTTP 500'));
    const parsed = await parseBody(DOUBTFUL, '2026-09-18', model);
    expect(parsed.status).toBe('needs_review');
    const problems = parsed.status === 'needs_review' ? parsed.problems.join(' | ') : '';
    expect(problems).toContain('SOMETHING UNHEARD OF');
    expect(problems).toContain('Model fallback failed: Model API returned HTTP 500');
  });

  test('a model extraction still has to pass validation', async () => {
    const { model } = fakeModel({ ...parseParadeState(GOOD, '2026-09-18').extraction, company: null });
    expect((await parseBody(DOUBTFUL, '2026-09-18', model)).status).toBe('invalid');
  });
});

describe('ingestMessage', () => {
  test('stores and parses a new message in one call', async () => {
    const { db, batches } = fakeDb({ inserted: [{ id: 5 }] });

    const outcome = await ingestMessage(db, { waMessageId: 'wa-5', body: GOOD }, NOW);

    expect(outcome).toMatchObject({ status: 'parsed', id: 5, paradeResponseId: 'Archer_2026-09-18_FPS' });
    expect(batches).toHaveLength(1);
  });

  test('leaves an already-parsed message alone, so a resend cannot replace newer rows', async () => {
    const { db, batches, updates } = fakeDb({
      selected: [{ id: 5, paradeResponseId: 'Archer_2026-09-18_FPS', error: null, processedAt: NOW }],
    });

    const outcome = await ingestMessage(db, { waMessageId: 'wa-5', body: GOOD }, NOW);

    expect(outcome).toEqual({ status: 'already_parsed', id: 5, paradeResponseId: 'Archer_2026-09-18_FPS' });
    expect(batches).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test('re-parses a message that failed before', async () => {
    const { db, batches } = fakeDb({
      selected: [{ id: 5, paradeResponseId: null, error: 'Needs review: old rule', processedAt: NOW }],
    });

    expect((await ingestMessage(db, { waMessageId: 'wa-5', body: GOOD }, NOW)).status).toBe('parsed');
    expect(batches).toHaveLength(1);
  });

  test('writes a doubtful message the model read, under the model name', async () => {
    const { db, batches } = fakeDb({ inserted: [{ id: 6 }] });
    const { model } = fakeModel(parseParadeState(GOOD, '2026-09-18').extraction);

    const outcome = await ingestMessage(db, { waMessageId: 'wa-6', body: DOUBTFUL }, NOW, model);

    expect(outcome.status).toBe('parsed');
    expect(batches).toHaveLength(1);
  });

  test('records why a doubtful message produced no rows', async () => {
    const { db, batches, updates } = fakeDb({ inserted: [{ id: 6 }] });

    const outcome = await ingestMessage(db, { waMessageId: 'wa-6', body: DOUBTFUL }, NOW);

    expect(outcome.status).toBe('needs_review');
    expect(batches).toHaveLength(0);
    expect(String(updates[0]!.error)).toStartWith('Needs review: ');
  });
});

describe('editMessage', () => {
  test('is not_found for an unknown id', async () => {
    const { db } = fakeDb({ selected: [] });
    expect(await editMessage(db, 9, GOOD)).toEqual({ status: 'not_found', id: 9 });
  });

  test('writes nothing when the new text does not parse', async () => {
    const { db, batches, updates } = fakeDb({ selected: [{ receivedAt: NOW }] });

    expect((await editMessage(db, 9, DOUBTFUL)).status).toBe('needs_review');
    expect(batches).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  test('replaces the text and the rows together', async () => {
    const { db, batches, updates } = fakeDb({ selected: [{ receivedAt: NOW }] });

    expect((await editMessage(db, 9, GOOD)).status).toBe('parsed');
    expect(batches).toHaveLength(1);
    expect(updates.at(-1)).toMatchObject({ body: GOOD, error: null, paradeResponseId: 'Archer_2026-09-18_FPS' });
  });
});

describe('deleteMessage', () => {
  test('is false for an unknown id', async () => {
    const { db, batches } = fakeDb({ selected: [] });
    expect(await deleteMessage(db, 9)).toBe(false);
    expect(batches).toHaveLength(0);
  });

  test('deletes the submission and the message in one batch', async () => {
    const { db, batches } = fakeDb({ selected: [{ paradeResponseId: 'Archer_2026-09-18_FPS' }] });
    expect(await deleteMessage(db, 9)).toBe(true);
    expect(batches[0]).toHaveLength(2);
  });

  test('deletes just the message when it never parsed', async () => {
    const { db, batches } = fakeDb({ selected: [{ paradeResponseId: null }] });
    expect(await deleteMessage(db, 9)).toBe(true);
    expect(batches[0]).toHaveLength(1);
  });
});
