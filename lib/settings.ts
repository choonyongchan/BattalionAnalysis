/**
 * The settings table: read every section, and save or reset one.
 *
 * Values are checked by the caller (`api/settings.ts` runs `validateSection` first); this file
 * only stores them. Every write is one statement, as `neon-http` requires, and names the
 * version it edited: a save from a page opened before someone else's save loses, rather than
 * silently undoing it.
 *
 * Server code receives settings as a value from `readSettings` and passes it on. It never uses
 * `src/model/settings/active.js`, because requests here run concurrently.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { settings } from '../db/schema.ts';
import { resolveSettings } from '../src/model/settings/resolve.js';

/** Every section's value in force, and per section its stored version and state. */
export type ResolvedSettings = {
  values: Record<string, Record<string, unknown>>;
  meta: Record<string, { version: number; isDefault: boolean; invalid: boolean }>;
};

/** What a save or reset did. */
export type SaveOutcome = { status: 'saved'; version: number } | { status: 'conflict' };

/**
 * Reads every section, defaults filled in.
 *
 * A stored section that fails validation is replaced by its default and logged by name only:
 * a setting's value can quote a personnel line, so it is never logged.
 *
 * @param db Any handle that can select from `settings` (owner or `dashboard_read`).
 * @returns The resolved settings.
 */
export async function readSettings(db: Db): Promise<ResolvedSettings> {
  const rows = await db
    .select({ section: settings.section, value: settings.value, version: settings.version })
    .from(settings);
  const resolved = resolveSettings(rows) as ResolvedSettings;
  for (const [section, meta] of Object.entries(resolved.meta)) {
    if (meta.invalid) console.error(`settings: the stored "${section}" section is invalid; using its defaults.`);
  }
  return resolved;
}

/**
 * Saves one section, if nobody has saved it since `expectedVersion`.
 *
 * @param db The owner handle.
 * @param section A known section name.
 * @param value The validated, cleaned value.
 * @param expectedVersion The version the caller edited: 0 when the section was a default.
 * @returns The new version, or a conflict.
 */
export async function saveSection(db: Db, section: string, value: unknown, expectedVersion: number): Promise<SaveOutcome> {
  const rows =
    expectedVersion === 0
      ? await db.insert(settings).values({ section, value }).onConflictDoNothing().returning({ version: settings.version })
      : await db
          .update(settings)
          .set({ value, version: sql`${settings.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(settings.section, section), eq(settings.version, expectedVersion)))
          .returning({ version: settings.version });
  const saved = rows[0];
  return saved ? { status: 'saved', version: saved.version } : { status: 'conflict' };
}

/**
 * Resets one section to its default by deleting its row, if nobody has saved it since
 * `expectedVersion`.
 *
 * @param db The owner handle.
 * @param section A known section name.
 * @param expectedVersion The version the caller saw: 0 when it was already the default.
 * @returns `saved` at version 0, or a conflict.
 */
export async function resetSection(db: Db, section: string, expectedVersion: number): Promise<SaveOutcome> {
  if (expectedVersion === 0) {
    const existing = await db.select({ version: settings.version }).from(settings).where(eq(settings.section, section));
    return existing.length === 0 ? { status: 'saved', version: 0 } : { status: 'conflict' };
  }
  const rows = await db
    .delete(settings)
    .where(and(eq(settings.section, section), eq(settings.version, expectedVersion)))
    .returning({ section: settings.section });
  return rows.length > 0 ? { status: 'saved', version: 0 } : { status: 'conflict' };
}
