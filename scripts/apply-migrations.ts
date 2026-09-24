/**
 * Applies pending Drizzle migrations over the Neon HTTP driver.
 *
 * `drizzle-kit migrate` drives its own websocket connection, which stalls against this
 * Neon endpoint from Windows. The HTTP driver is the one the application itself uses and
 * works fine, so migrations go through it instead.
 *
 * This is not a reimplementation of Drizzle's migrator -- it reproduces exactly the
 * bookkeeping `drizzle-kit migrate` does, so the two stay interchangeable:
 *   - statements are split on the `--> statement-breakpoint` marker drizzle-kit writes;
 *   - applied migrations are recorded in `drizzle.__drizzle_migrations`, keyed by the
 *     SHA-256 of the migration file (with LF line endings), which is how drizzle-kit decides
 *     what is pending.
 *
 * Re-runnable: a migration already recorded is skipped.
 *
 * Usage:  bun --env-file=.env.local scripts/apply-migrations.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'db', 'migrations');

/** One entry of drizzle-kit's `meta/_journal.json`. */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** One migration file, keyed as drizzle-kit records it. */
export interface Migration extends JournalEntry {
  text: string;
  /** SHA-256 of the file, the key in `drizzle.__drizzle_migrations`. */
  hash: string;
}

/**
 * Reads every migration in journal order.
 *
 * @returns The migrations.
 */
export function readMigrations(): Migration[] {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };
  return journal.entries.map((entry) => {
    // Hashed as LF: a Windows checkout with `core.autocrlf` rewrites the file as CRLF, which
    // would change its hash and make an applied migration look pending.
    const text = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8').replace(/\r\n/g, '\n');
    return { ...entry, text, hash: createHash('sha256').update(text).digest('hex') };
  });
}

/**
 * Creates drizzle-kit's bookkeeping table if it is missing.
 *
 * @param sql A Neon query function.
 * @returns Nothing.
 */
export async function ensureMigrationsTable(sql: NeonQueryFunction<false, false>): Promise<void> {
  await sql`create schema if not exists drizzle`;
  await sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`;
}

/**
 * Applies every migration that has not been recorded yet.
 *
 * @param url The connection string of the database to migrate.
 * @param log Where progress goes; the test suite passes a no-op.
 * @returns Nothing; a failure throws.
 */
export async function applyMigrations(url: string, log: (line: string) => void = console.log): Promise<void> {
  const sql = neon(url);
  await ensureMigrationsTable(sql);

  const applied = await sql`select hash from drizzle.__drizzle_migrations`;
  const seen = new Set((applied as Record<string, unknown>[]).map((row) => String(row.hash)));

  for (const entry of readMigrations()) {
    const { text, hash } = entry;
    if (seen.has(hash)) {
      log(`skip  ${entry.tag} (already applied)`);
      continue;
    }

    const statements = text
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    log(`apply ${entry.tag} (${statements.length} statements)`);
    for (const [index, statement] of statements.entries()) {
      try {
        await sql.query(statement);
      } catch (error) {
        console.error(`\nstatement ${index + 1} failed:\n${statement.slice(0, 400)}\n`);
        throw error;
      }
    }

    await sql`
      insert into drizzle.__drizzle_migrations (hash, created_at)
      values (${hash}, ${entry.when})`;
    log(`done  ${entry.tag}`);
  }
}

/**
 * Migrates the database named by `DATABASE_URL`.
 *
 * @returns Nothing; progress is logged and a failure throws.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  await applyMigrations(url);
}

if (import.meta.main) await main();
