/**
 * The settings table: read every section, save or reset one. Each write is one statement naming the
 * version it edited, so a save from a stale page loses instead of undoing someone else's.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { settings } from '../db/schema.ts';
import { resolveSettings, type ResolvedSettings } from '../../shared/settings/resolve.ts';

/** What a save or reset did. */
export type SaveOutcome = { status: 'saved'; version: number } | { status: 'conflict' };

/** Reads every section, defaults filled in; an invalid stored section is logged by name only, never its value. */
export async function readSettings(db: Db): Promise<ResolvedSettings> {
  const rows = await db
    .select({ section: settings.section, value: settings.value, version: settings.version })
    .from(settings);
  const resolved = resolveSettings(rows);
  for (const [section, meta] of Object.entries(resolved.meta)) {
    if (meta.invalid) console.error(`settings: the stored "${section}" section is invalid; using its defaults.`);
  }
  return resolved;
}

/** Saves one section, if nobody has saved it since `expectedVersion`. */
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

/** Resets one section to its default by deleting its row, if nobody has saved it since `expectedVersion`. */
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
