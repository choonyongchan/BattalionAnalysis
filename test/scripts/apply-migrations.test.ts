/**
 * Which migrations the migrator treats as applied: the LF hash it records, or the CRLF hash a
 * file applied from a CRLF checkout was recorded under; and how it applies the rest. No
 * database: the apply loop runs against a fake query function.
 */
import { createHash } from 'node:crypto';
import { describe, expect, spyOn, test } from 'bun:test';
import { applyMigrations, isApplied, readMigrations, type Migration } from '../../scripts/apply-migrations.ts';

/**
 * The hex SHA-256 of a text.
 *
 * @param text The text to hash.
 * @returns The hex digest.
 */
function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const TEXT = 'CREATE TABLE "a" ("id" integer);\n--> statement-breakpoint\nCREATE INDEX "a_idx" ON "a" ("id");\n';
const MIGRATION = { text: TEXT, hash: sha256(TEXT) };

describe('isApplied', () => {
  test('a recorded LF hash marks the migration applied', () => {
    expect(isApplied(MIGRATION, new Set([MIGRATION.hash]))).toBe(true);
  });

  test('a recorded CRLF hash marks the migration applied', () => {
    expect(isApplied(MIGRATION, new Set([sha256(TEXT.replace(/\n/g, '\r\n'))]))).toBe(true);
  });

  test('neither hash recorded leaves the migration pending', () => {
    expect(isApplied(MIGRATION, new Set([sha256('something else')]))).toBe(false);
    expect(isApplied(MIGRATION, new Set())).toBe(false);
  });
});

describe('readMigrations', () => {
  test('hashes each file as LF text, whatever the checkout wrote', () => {
    for (const migration of readMigrations()) {
      expect(migration.text).not.toContain('\r\n');
      expect(migration.hash).toBe(sha256(migration.text));
    }
  });
});

/**
 * A migration named `tag`, built from its statements the way drizzle-kit writes them.
 *
 * @param tag The journal tag.
 * @param statements The SQL statements.
 * @returns The migration.
 */
function migration(tag: string, statements: string[]): Migration {
  const text = statements.join('\n--> statement-breakpoint\n') + '\n';
  return { idx: 0, when: 1_700_000_000_000, tag, text, hash: sha256(text) };
}

/**
 * A stand-in for `neon(url)` that answers the bookkeeping queries and records the rest.
 *
 * @param recorded The hashes `drizzle.__drizzle_migrations` already holds.
 * @param failOn A statement that throws when run.
 * @returns The query function, the statements it ran and the bookkeeping rows it inserted.
 */
function fakeSql(recorded: string[], failOn?: string) {
  const queries: string[] = [];
  const inserts: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('select hash')) return Promise.resolve(recorded.map((hash) => ({ hash })));
    if (text.includes('insert into drizzle.__drizzle_migrations')) inserts.push(values);
    return Promise.resolve([]);
  }) as any;
  sql.query = async (statement: string) => {
    if (statement === failOn) throw new Error('syntax error');
    queries.push(statement);
    return [];
  };
  return { sql, queries, inserts };
}

describe('applyMigrations', () => {
  const DONE = migration('0000_done', ['CREATE TABLE "old" ("id" integer);']);
  const PENDING = migration('0001_pending', ['CREATE TABLE "a" ("id" integer);', 'CREATE INDEX "a_idx" ON "a" ("id");']);

  test('runs each statement of a pending migration in order, then records it', async () => {
    const fake = fakeSql([DONE.hash]);
    const log: string[] = [];
    await applyMigrations('unused', (line) => log.push(line), { sql: fake.sql, migrations: [DONE, PENDING] });

    expect(fake.queries).toEqual(['CREATE TABLE "a" ("id" integer);', 'CREATE INDEX "a_idx" ON "a" ("id");']);
    expect(fake.inserts).toEqual([[PENDING.hash, PENDING.when]]);
    expect(log).toEqual([
      'skip  0000_done (already applied)',
      'apply 0001_pending (2 statements)',
      'done  0001_pending',
    ]);
  });

  test('stops at a failing statement, names it, and leaves the migration unrecorded', async () => {
    const bad = migration('0001_bad', ['CREATE TABLE "a" ("id" integer);', 'CREATE TABL oops;', 'CREATE TABLE "b" ("id" integer);']);
    const fake = fakeSql([], 'CREATE TABL oops;');
    const errors = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(applyMigrations('unused', () => {}, { sql: fake.sql, migrations: [bad] })).rejects.toThrow('syntax error');
      expect(errors.mock.calls[0]![0]).toContain('statement 2 failed');
    } finally {
      errors.mockRestore();
    }
    expect(fake.queries).toEqual(['CREATE TABLE "a" ("id" integer);']);
    expect(fake.inserts).toEqual([]);
  });
});
