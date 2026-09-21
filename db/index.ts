/**
 * The Neon database handle shared by the FormSG webhook and the WhatsApp runner.
 *
 * `neon-http` has no interactive transactions, so atomic writes go through `db.batch([...])`.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema.ts';

let db: ReturnType<typeof drizzle> | undefined;

/**
 * Returns the memoised Drizzle handle for `DATABASE_URL`.
 *
 * @throws {Error} If `DATABASE_URL` is unset.
 */
export function getDb(): ReturnType<typeof drizzle> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local.');
  return (db ??= drizzle(neon(url), { schema }));
}
