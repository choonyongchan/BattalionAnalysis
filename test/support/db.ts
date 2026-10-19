/**
 * A real Neon branch (`TEST_DATABASE_URL` in `.env.test`) for the integration and end-to-end suites; unset, they
 * are skipped. Every test empties its tables, and `assertSafeTestUrl` refuses the app's own database.
 */
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/neon-http';
import type { Db } from '../../backend/db/index.ts';
import * as schema from '../../backend/db/schema.ts';
import { applyMigrations, ensureMigrationsTable, readMigrations } from '../../backend/scripts/apply-migrations.ts';

/** The test branch's connection string, or undefined when DB suites should be skipped. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || undefined;

/** Whether the DB suites run; pass to `describe.skipIf(!hasTestDb)`. */
export const hasTestDb = Boolean(TEST_DATABASE_URL);

/**
 * The same branch as the read-only `dashboard_read` role (`db/grants-dashboard.sql`), or
 * undefined to skip the role's own tests.
 */
export const TEST_DASHBOARD_DATABASE_URL = process.env.TEST_DASHBOARD_DATABASE_URL || undefined;

/** Generous per-test timeout: each statement is an HTTPS round trip to Neon. */
export const DB_TIMEOUT_MS = 60_000;

/** Every table the app writes, emptied before each test. */
const TABLES = [
  'raw_messages',
  'parade_submissions',
  'strength_rows',
  'personnel_rows',
  'command_roster_rows',
  'section_counts',
  'report_sick_formsg',
  'sft_formsg',
  'settings',
];

/** Connection-string variables that name databases the tests must never truncate. */
const PROTECTED_VARS = ['DATABASE_URL', 'DATABASE_URL_DIRECT', 'DASHBOARD_DATABASE_URL'];

/**
 * The Neon endpoint a connection string points at, ignoring the pooler suffix, so the pooled and direct URLs
 * of one branch compare equal.
 */
export function endpointOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace('-pooler.', '.');
}

/** Throws unless a test URL is clearly separate from every configured app database. */
export function assertSafeTestUrl(url: string, env: Record<string, string | undefined> = process.env): void {
  for (const name of PROTECTED_VARS) {
    const other = env[name];
    if (other && endpointOf(other) === endpointOf(url)) {
      throw new Error(`TEST_DATABASE_URL points at the same Neon endpoint as ${name}; use a separate test branch.`);
    }
  }
}

/**
 * Records every migration as applied when the branch already has the app's tables but no bookkeeping rows. A
 * schema-only Neon branch copies the schema and leaves every table empty, `drizzle.__drizzle_migrations`
 * included, so the migrator would otherwise try to create the tables again. This is the same baselining the
 * main branch had (see `tasks/todo.md`).
 */
async function baselineSchemaOnlyBranch(url: string): Promise<void> {
  const sql = neon(url);
  await ensureMigrationsTable(sql);
  const [state] = (await sql`
    select to_regclass('public.raw_messages') is not null as "hasTables",
           (select count(*)::int from drizzle.__drizzle_migrations) as "recorded"`) as Array<{ hasTables: boolean; recorded: number }>;
  if (!state!.hasTables || state!.recorded > 0) return;
  for (const { hash, when } of readMigrations()) {
    await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${when})`;
  }
}

let handle: Db | undefined;
let migrated: Promise<void> | undefined;

/** The test branch's Drizzle handle, built like `db/index.ts#getDb`. Migrates on first use. */
export async function testDb(): Promise<Db> {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set.');
  if (!handle) {
    assertSafeTestUrl(TEST_DATABASE_URL);
    handle = drizzle(neon(TEST_DATABASE_URL), { schema });
    const url = TEST_DATABASE_URL;
    migrated = baselineSchemaOnlyBranch(url).then(() => applyMigrations(url, () => {}));
  }
  await migrated;
  return handle;
}

/** The test branch as `dashboard_read`, built like the dashboard route's handle. */
export function readOnlyTestDb(): Db {
  if (!TEST_DASHBOARD_DATABASE_URL) throw new Error('TEST_DASHBOARD_DATABASE_URL is not set.');
  assertSafeTestUrl(TEST_DASHBOARD_DATABASE_URL);
  return drizzle(neon(TEST_DASHBOARD_DATABASE_URL), { schema });
}

/** Empties every app table and restarts their ids, so each test sees a fresh database. */
export async function resetTestDb(): Promise<Db> {
  const db = await testDb();
  await db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`));
  return db;
}

/** Counts rows in a table, optionally for one parade submission. */
export async function countRows(db: Db, table: string, paradeResponseId?: string): Promise<number> {
  const where = paradeResponseId ? sql` where parade_response_id = ${paradeResponseId}` : sql``;
  const result = await db.execute(sql`select count(*)::int as n from ${sql.identifier(table)}${where}`);
  return Number((result.rows[0] as { n: number }).n);
}
