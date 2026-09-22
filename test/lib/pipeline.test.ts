/**
 * The write path: how a text parses, and what ingest, edit and delete leave in the database.
 *
 * `parseBody` needs no database. Everything else runs against the Neon test branch
 * (`TEST_DATABASE_URL`, see `test/support/db.ts`) and is checked by reading the tables back, so
 * a test holds for any implementation that leaves the same rows behind. Only the OpenAI fallback
 * is faked: it is a paid external API.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/index.ts';
import { paradeSubmissions, personnelRows, rawMessages } from '../../db/schema.ts';
import { parseParadeState } from '../../lib/parser/deterministic.ts';
import type { Extraction } from '../../lib/parser/extraction.ts';
import {
  deleteMessage,
  editMessage,
  getMessage,
  ingestMessage,
  listMessages,
  parseBody,
  type ModelParser,
} from '../../lib/pipeline.ts';
import { countRows, DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';
import { expectedCounts, expectedKey, renderParadeState, type ParadeSpec } from '../support/paradeState.ts';
import { DOUBTFUL_EDITS, LAST_PARADE, randomSpec, SCENARIOS } from '../support/scenarios.ts';

/** The scenario with an entry in every section; the doubtful edits are written against it. */
const FULL = SCENARIOS[1]!.spec;
const GOOD = renderParadeState(FULL);
const DOUBTFUL = DOUBTFUL_EDITS[0]!.edit(GOOD);
const LAST = renderParadeState(LAST_PARADE);

/** The child tables of a submission, keyed as `expectedCounts` names their row counts. */
const CHILD_TABLES = {
  strength: 'strength_rows',
  personnel: 'personnel_rows',
  roster: 'command_roster_rows',
  sectionCounts: 'section_counts',
} as const;

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

/** What the model would read the doubtful message as: the good message's extraction. */
const MODEL_READING = parseParadeState(GOOD, FULL.date).extraction;

/**
 * The receipt time a spec's message arrives at: the morning of its parade date.
 *
 * @param spec The parade state.
 * @returns The time.
 */
function arrival(spec: Pick<ParadeSpec, 'date'>): Date {
  return new Date(`${spec.date}T00:30:00Z`);
}

describe('parseBody', () => {
  test.each([
    ['a template message', GOOD, null, 'parsed'],
    ['a doubtful message with no model', DOUBTFUL, null, 'needs_review'],
    ['a last parade state', LAST, null, 'rejected'],
    ['a doubtful message the model reads', DOUBTFUL, MODEL_READING, 'parsed'],
    ['a doubtful message the model misreads', DOUBTFUL, { ...MODEL_READING, company: null }, 'invalid'],
    ['a doubtful message when the model fails', DOUBTFUL, new Error('HTTP 500'), 'needs_review'],
  ] as const)('%s → %s', async (_name, text, answer, status) => {
    const model = answer === null ? null : fakeModel(answer as Extraction | Error).model;
    expect((await parseBody(text, FULL.date, model)).status).toBe(status);
  });

  test('a message the rules are sure of never reaches the model', async () => {
    const { model, calls } = fakeModel(new Error('should not be called'));
    expect(await parseBody(GOOD, FULL.date, model)).toMatchObject({ status: 'parsed', parser: 'deterministic', paradeResponseId: expectedKey(FULL) });
    expect(calls).toEqual([]);
  });

  test('a model reading is recorded under the model name', async () => {
    const { model, calls } = fakeModel(MODEL_READING);
    expect(await parseBody(DOUBTFUL, FULL.date, model)).toMatchObject({ status: 'parsed', parser: 'gpt-test' });
    expect(calls).toEqual([DOUBTFUL]);
  });

  test('a failed model call keeps the rules’ reasons and adds its own', async () => {
    const parsed = await parseBody(DOUBTFUL, FULL.date, fakeModel(new Error('HTTP 500')).model);
    const problems = parsed.status === 'needs_review' ? parsed.problems.join(' | ') : '';
    expect(problems).toContain('SOMETHING UNHEARD OF');
    expect(problems).toContain('HTTP 500');
  });
});

describe.skipIf(!hasTestDb)('against the test database', () => {
  let db: Db;
  beforeEach(async () => {
    db = await resetTestDb();
  }, DB_TIMEOUT_MS);

  /**
   * Reads the stored message row.
   *
   * @param id The `raw_messages` id.
   * @returns The row.
   */
  async function message(id: number) {
    const [row] = await db.select().from(rawMessages).where(eq(rawMessages.id, id));
    return row;
  }

  /**
   * Asserts that exactly the spec's rows exist under its key.
   *
   * @param spec The parade state.
   */
  async function expectRowsOf(spec: ParadeSpec) {
    const key = expectedKey(spec);
    expect(await countRows(db, 'parade_submissions', key)).toBe(1);
    for (const [kind, table] of Object.entries(CHILD_TABLES)) {
      expect({ table, rows: await countRows(db, table, key) }).toEqual({
        table,
        rows: expectedCounts(spec)[kind as keyof typeof CHILD_TABLES],
      });
    }
  }

  describe('ingestMessage', () => {
    const CASES: Array<[string, ParadeSpec]> = [
      ...SCENARIOS.map(({ name, spec }): [string, ParadeSpec] => [name, spec]),
      ...[101, 202, 303].map((seed): [string, ParadeSpec] => [`generated #${seed}`, randomSpec(seed)]),
    ];

    test.each(CASES)(
      'stores %s with one row per line of the message',
      async (_name, spec) => {
        const outcome = await ingestMessage(db, { waMessageId: 'wa-1', body: renderParadeState(spec) }, arrival(spec));

        expect(outcome).toMatchObject({ status: 'parsed', paradeResponseId: expectedKey(spec), counts: expectedCounts(spec) });
        await expectRowsOf(spec);
        expect(await message(outcome.id)).toMatchObject({ paradeResponseId: expectedKey(spec), error: null });
        const [submission] = await db.select().from(paradeSubmissions);
        expect(submission).toMatchObject({ company: spec.company, date: spec.date, session: 'FPS', model: 'deterministic' });
      },
      DB_TIMEOUT_MS,
    );

    test('a resend of a parsed message changes nothing', async () => {
      const first = await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));
      const again = await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));

      expect(again).toEqual({ status: 'already_parsed', id: first.id, paradeResponseId: expectedKey(FULL) });
      expect(await countRows(db, 'raw_messages')).toBe(1);
      await expectRowsOf(FULL);
    }, DB_TIMEOUT_MS);

    test('a doubtful message is kept for review, with the reason, and writes no rows', async () => {
      const outcome = await ingestMessage(db, { waMessageId: 'wa-1', body: DOUBTFUL }, arrival(FULL));

      expect(outcome.status).toBe('needs_review');
      expect((await message(outcome.id))!.error).toStartWith('Needs review: ');
      expect((await message(outcome.id))!.processedAt).not.toBeNull();
      expect(await countRows(db, 'parade_submissions')).toBe(0);
    }, DB_TIMEOUT_MS);

    test('a message that failed is parsed again when it is resent', async () => {
      await ingestMessage(db, { waMessageId: 'wa-1', body: DOUBTFUL }, arrival(FULL));
      const retry = await ingestMessage(db, { waMessageId: 'wa-1', body: DOUBTFUL }, arrival(FULL), fakeModel(MODEL_READING).model);

      expect(retry.status).toBe('parsed');
      expect(await countRows(db, 'raw_messages')).toBe(1);
      expect((await message(retry.id))!.error).toBeNull();
      await expectRowsOf(FULL);
    }, DB_TIMEOUT_MS);

    test('rows the model read say which model wrote them', async () => {
      await ingestMessage(db, { waMessageId: 'wa-1', body: DOUBTFUL }, arrival(FULL), fakeModel(MODEL_READING).model);
      const [submission] = await db.select().from(paradeSubmissions);
      expect(submission!.model).toBe('gpt-test');
    }, DB_TIMEOUT_MS);

    test('a last parade state is stored with the reason and writes no rows', async () => {
      const outcome = await ingestMessage(db, { waMessageId: 'wa-1', body: LAST }, arrival(FULL));
      expect(outcome.status).toBe('rejected');
      expect((await message(outcome.id))!.error).toBeTruthy();
      expect(await countRows(db, 'parade_submissions')).toBe(0);
    }, DB_TIMEOUT_MS);

    test('a later message for the same company and day replaces the earlier rows', async () => {
      const smaller: ParadeSpec = { ...FULL, units: [FULL.units[0]!] };
      await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));
      await ingestMessage(db, { waMessageId: 'wa-2', body: renderParadeState(smaller) }, arrival(FULL));

      await expectRowsOf(smaller);
      expect(await countRows(db, 'raw_messages')).toBe(2);
    }, DB_TIMEOUT_MS);

    test('different companies on one day are kept apart', async () => {
      const specs = SCENARIOS.map(({ spec }) => spec);
      for (const [index, spec] of specs.entries()) {
        await ingestMessage(db, { waMessageId: `wa-${index}`, body: renderParadeState(spec) }, arrival(spec));
      }
      for (const spec of specs) await expectRowsOf(spec);
    }, DB_TIMEOUT_MS);
  });

  describe('editMessage', () => {
    test('a corrected date moves the submission and replaces the text', async () => {
      const { id } = await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));
      const moved: ParadeSpec = { ...FULL, date: '2026-09-19' };
      const text = renderParadeState(moved);

      expect(await editMessage(db, id, text)).toMatchObject({ status: 'parsed', paradeResponseId: expectedKey(moved) });
      expect(await countRows(db, 'parade_submissions', expectedKey(FULL))).toBe(0);
      expect(await countRows(db, 'personnel_rows', expectedKey(FULL))).toBe(0);
      await expectRowsOf(moved);
      expect((await getMessage(db, id))!.body).toBe(text);
    }, DB_TIMEOUT_MS);

    test('a correction that still does not parse changes nothing', async () => {
      const { id } = await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));

      expect((await editMessage(db, id, DOUBTFUL)).status).toBe('needs_review');
      await expectRowsOf(FULL);
      expect((await getMessage(db, id))!.body).toBe(GOOD);
    }, DB_TIMEOUT_MS);

    test('correcting a message kept for review writes its rows', async () => {
      const { id } = await ingestMessage(db, { waMessageId: 'wa-1', body: DOUBTFUL }, arrival(FULL));

      expect((await editMessage(db, id, GOOD)).status).toBe('parsed');
      await expectRowsOf(FULL);
      expect((await message(id))!.error).toBeNull();
    }, DB_TIMEOUT_MS);

    test('an unknown id is not_found', async () => {
      expect(await editMessage(db, 999, GOOD)).toEqual({ status: 'not_found', id: 999 });
    }, DB_TIMEOUT_MS);
  });

  describe('deleteMessage', () => {
    test('removes the message and everything parsed from it, and nothing else', async () => {
      const other = SCENARIOS[0]!.spec;
      const { id } = await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));
      await ingestMessage(db, { waMessageId: 'wa-2', body: renderParadeState(other) }, arrival(other));

      expect(await deleteMessage(db, id)).toBe(true);
      expect(await getMessage(db, id)).toBeNull();
      expect(await countRows(db, 'parade_submissions', expectedKey(FULL))).toBe(0);
      for (const table of Object.values(CHILD_TABLES)) expect(await countRows(db, table, expectedKey(FULL))).toBe(0);
      await expectRowsOf(other);
    }, DB_TIMEOUT_MS);

    test('removes a message that never parsed', async () => {
      const { id } = await ingestMessage(db, { waMessageId: 'wa-1', body: DOUBTFUL }, arrival(FULL));
      expect(await deleteMessage(db, id)).toBe(true);
      expect(await countRows(db, 'raw_messages')).toBe(0);
    }, DB_TIMEOUT_MS);

    test('is false for an unknown id', async () => {
      expect(await deleteMessage(db, 999)).toBe(false);
    }, DB_TIMEOUT_MS);
  });

  describe('listMessages and getMessage', () => {
    test('list newest first, without any text; get returns the text', async () => {
      const first = await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));
      const second = await ingestMessage(db, { waMessageId: 'wa-2', body: DOUBTFUL }, arrival(FULL));

      const listed = await listMessages(db);
      expect(listed.map((row) => row.id)).toEqual([second.id, first.id]);
      for (const row of listed) expect(row).not.toHaveProperty('body');
      expect(listed[0]!.error).toStartWith('Needs review: ');
      expect(await getMessage(db, first.id)).toEqual({ id: first.id, body: GOOD });
    }, DB_TIMEOUT_MS);

    test('personnel rows keep the stated names', async () => {
      await ingestMessage(db, { waMessageId: 'wa-1', body: GOOD }, arrival(FULL));
      const names = (await db.select({ name: personnelRows.name }).from(personnelRows)).map((row) => row.name).sort();
      expect(names).toEqual(FULL.units.flatMap((unit) => unit.entries.map((entry) => entry.name)).sort());
    }, DB_TIMEOUT_MS);
  });
});
