/**
 * Applies a `db/grants*.sql` file over the Neon HTTP driver, for machines without psql.
 *
 * Generates a fresh hex password for `:'password'`, runs each `--> statement-breakpoint`
 * chunk, and prints the role's connection string. Re-running rotates the password.
 *
 * Usage:  bun --env-file=.env.local scripts/apply-grants.ts db/grants-<name>.sql
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

/**
 * Runs the grants file named on the command line.
 *
 * @throws {Error} If `DATABASE_URL` or the file argument is missing, or a statement fails.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  const file = process.argv[2];
  if (!url || !file) throw new Error('Usage: DATABASE_URL=... bun scripts/apply-grants.ts <file>');

  // ponytail: hex only, so the literal needs no escaping.
  const password = randomBytes(24).toString('hex');
  const text = readFileSync(file, 'utf8')
    .replace(/^\\.*$/gm, '') // psql meta-commands such as \set
    .replaceAll(":'password'", `'${password}'`);
  const role = /ALTER ROLE (\w+) PASSWORD/.exec(text)?.[1];
  if (!role) throw new Error(`${file} has no ALTER ROLE ... PASSWORD statement.`);

  const sql = neon(url);
  for (const statement of text.split('--> statement-breakpoint')) {
    const body = statement.replace(/^\s*--.*$/gm, '').trim();
    if (body) await sql.query(body);
  }

  const target = new URL(url);
  target.username = role;
  target.password = password;
  console.log(`${role} ready. Connection string:\n${target}`);
}

await main();
