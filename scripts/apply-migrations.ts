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
 *     SHA-256 of the migration file, which is how drizzle-kit decides what is pending.
 *
 * Re-runnable: a migration already recorded is skipped.
 *
 * Usage:  bun --env-file=.env.local scripts/apply-migrations.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { neon } from '@neondatabase/serverless';

const MIGRATIONS_DIR = join(import.meta.dir, '..', 'db', 'migrations');

/** One entry of drizzle-kit's `meta/_journal.json`. */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/**
 * Applies every migration that has not been recorded yet.
 *
 * @returns Nothing; progress is logged and a failure throws.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const sql = neon(url);

  await sql`create schema if not exists drizzle`;
  await sql`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )`;

  const applied = await sql`select hash from drizzle.__drizzle_migrations`;
  const seen = new Set(applied.map((row: Record<string, unknown>) => String(row.hash)));

  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };

  for (const entry of journal.entries) {
    const text = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
    const hash = createHash('sha256').update(text).digest('hex');
    if (seen.has(hash)) {
      console.log(`skip  ${entry.tag} (already applied)`);
      continue;
    }

    const statements = text
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

    console.log(`apply ${entry.tag} (${statements.length} statements)`);
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
    console.log(`done  ${entry.tag}`);
  }
}

await main();
