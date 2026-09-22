/**
 * The Neon database handles shared by the API routes and scripts.
 *
 * `neon-http` has no interactive transactions, so atomic writes go through `db.batch([...])`.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/** One handle per connection-string variable, so the owner and read-only roles never mix. */
const handles = new Map<string, Db>();

/**
 * Returns the memoised Drizzle handle for a connection-string environment variable.
 *
 * @param envVar The variable holding the connection string: `DATABASE_URL` (owner) or
 *   `DASHBOARD_DATABASE_URL` (the read-only `dashboard_read` role).
 * @returns The handle.
 * @throws {Error} If the variable is unset.
 */
export function getDb(envVar = 'DATABASE_URL'): Db {
  const url = process.env[envVar];
  if (!url) throw new Error(`${envVar} is not set. Copy .env.example to .env.local.`);
  let db = handles.get(envVar);
  if (!db) {
    db = drizzle(neon(url), { schema });
    handles.set(envVar, db);
  }
  return db;
}
