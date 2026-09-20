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

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  }
  return value;
}

/** Read-write connection. Every intake route and the cron drain use this. */
export const db = drizzle(neon(required('DATABASE_URL')), { schema });

/** Read-only connection, denied `SELECT` on `raw_messages.body` at the database level. */
export const readDb = drizzle(
  neon(process.env.DATABASE_URL_READONLY || required('DATABASE_URL')),
  { schema },
);
