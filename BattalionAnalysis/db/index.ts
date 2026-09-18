/**
 * The one Neon connection every `api/` route writes and reads through.
 *
 * The HTTP driver keeps a Vercel Function stateless: no pool to warm, no socket left open.
 */
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

export const db = drizzle(neon(process.env.DATABASE_URL!), { schema });
