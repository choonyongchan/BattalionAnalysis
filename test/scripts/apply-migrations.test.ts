/**
 * Which migrations the migrator treats as applied: the LF hash it records, or the CRLF hash a
 * file applied from a CRLF checkout was recorded under. Pure; no database.
 */
import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { isApplied, readMigrations } from '../../scripts/apply-migrations.ts';

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
