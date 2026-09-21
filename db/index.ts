/**
 * The Neon connections every `api/` route reads and writes through.
 *
 * The HTTP driver keeps a Vercel Function stateless: no pool to warm, no socket left open.
 * Its one constraint shapes the whole write path — `neon-http` has no interactive
 * transactions, so anything that must be atomic goes through `db.batch([...])`, where no
 * statement may depend on an earlier statement's `RETURNING`. That is why
 * `parade_response_id` is a computable natural key rather than a surrogate id.
 *
 * Two connections, not one, because the separation is enforced by Postgres rather than by
 * remembering:
 *
 *   - `db`       writes. Used by the intake routes and the cron drain.
 *   - `readDb`   reads for the dashboard, as a role with no `SELECT` on `raw_messages.body`.
 *
 * `raw_messages.body` is the parade-state free text: NRICs, full names and diagnoses in one
 * blob. Under the old spreadsheet the dashboard was kept away from it by a column
 * projection in application code, which a careless edit could undo. Here a read route that
 * asks for it gets an error from the database instead of a leak.
 *
 * `DATABASE_URL_READONLY` falls back to `DATABASE_URL` so local development and tests work
 * with one variable. Production sets both; the fallback is a convenience, not the design.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';

/*
 * BOTH CONNECTIONS ARE BUILT ON FIRST USE, NOT ON IMPORT.
 *
 * Eager construction reads `process.env` while the module graph is still loading, which has
 * two consequences that are easy to mistake for unrelated problems. A route needing only the
 * read connection would fail to import because the write URL was absent -- the error names
 * `DATABASE_URL` and says nothing about which route wanted it. And no test could import a
 * route module at all without real credentials in the environment, which pushes tests
 * towards mocking the module rather than injecting a handle.
 *
 * Memoised, so a warm function still reuses one client per connection.
 */

/** Cached handles, keyed by the variable they were built from. */
const handles = new Map<string, ReturnType<typeof drizzle>>();

/**
 * Reads a required environment variable.
 *
 * @param name The variable name.
 * @returns Its value.
 * @throws {Error} If it is unset or empty.
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

/**
 * Builds or returns the cached handle for one connection string.
 *
 * @param key The cache key, which is the variable name.
 * @param url The connection string.
 * @returns A Drizzle handle bound to the schema.
 */
function handle(key: string, url: string): ReturnType<typeof drizzle> {
  let existing = handles.get(key);
  if (!existing) {
    existing = drizzle(neon(url), { schema });
    handles.set(key, existing);
  }
  return existing;
}

/**
 * The read-write connection. Every intake route and the cron drain use this.
 *
 * @returns A Drizzle handle.
 * @throws {Error} If `DATABASE_URL` is unset.
 */
export function getDb(): ReturnType<typeof drizzle> {
  return handle('DATABASE_URL', required('DATABASE_URL'));
}

/**
 * The read-only connection, denied `SELECT` on `raw_messages.body` by Postgres itself.
 *
 * Falls back to `DATABASE_URL` so local development needs one variable. Production sets both;
 * the fallback is a convenience, and it is the reason `api/dashboard.ts` must still project
 * its columns explicitly rather than relying on the grant alone.
 *
 * @returns A Drizzle handle.
 * @throws {Error} If neither variable is set.
 */
export function getReadDb(): ReturnType<typeof drizzle> {
  const url = process.env.DATABASE_URL_READONLY;
  return url ? handle('DATABASE_URL_READONLY', url) : getDb();
}
