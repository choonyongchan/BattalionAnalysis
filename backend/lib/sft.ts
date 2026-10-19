/**
 * Lists, corrects and deletes stored SFT records for the Deposit page; a correction re-derives
 * `nameKey`, `company`/`unitCoy` and `sftDate` exactly as the webhook does on insert.
 */
import { desc, eq } from 'drizzle-orm';
import { sftFormsg } from '../db/schema.ts';
import { companyFromUnitCoy, type Company } from '../../shared/domain.ts';
import { normaliseName } from '../../shared/identity.ts';
import { toSgtDate } from './formsg/fields.ts';

// neon-http's Drizzle handle; typed loosely so tests can pass a fake.
type Db = any;

/** The columns a correction sets, as `src/model/sftEdit.js#validateSftEdit` returns them. */
export interface SftEdit {
  rank: string | null;
  name: string;
  company: Company | null;
  groupIc: string | null;
  pesStatus: string | null;
  exercises: string | null;
  sfabtType: string | null;
  location: string | null;
  /** ISO instant. */
  timestamp: string;
  informedCommander: boolean;
  windowConfirmed: boolean;
}

/** What the Deposit page lists and edits: every answer, never the bookkeeping. */
const LISTED = {
  responseId: sftFormsg.responseId,
  timestamp: sftFormsg.timestamp,
  sftDate: sftFormsg.sftDate,
  rank: sftFormsg.rank,
  name: sftFormsg.name,
  company: sftFormsg.company,
  groupIc: sftFormsg.groupIc,
  pesStatus: sftFormsg.pesStatus,
  exercises: sftFormsg.exercises,
  sfabtType: sftFormsg.sfabtType,
  location: sftFormsg.location,
  informedCommander: sftFormsg.informedCommander,
  windowConfirmed: sftFormsg.windowConfirmed,
};

/** Lists every SFT record, newest first. */
export async function listSftRecords(db: Db): Promise<unknown[]> {
  return db.select(LISTED).from(sftFormsg).orderBy(desc(sftFormsg.timestamp));
}

/**
 * The `unit_coy` a corrected company is stored under: the soldier's own answer when it already names that
 * company, else the company itself, so the two never disagree.
 */
function unitCoyFor(current: string | null, company: Company | null): string | null {
  if (companyFromUnitCoy(current) === company) return current;
  return company;
}

/** Replaces a record's answers with a clerk's correction. */
export async function updateSftRecord(db: Db, id: string, edit: SftEdit): Promise<unknown | null> {
  const [current] = await db.select({ unitCoy: sftFormsg.unitCoy }).from(sftFormsg).where(eq(sftFormsg.responseId, id));
  if (!current) return null;
  const [row] = await db
    .update(sftFormsg)
    .set({
      ...edit,
      nameKey: normaliseName(edit.name),
      unitCoy: unitCoyFor(current.unitCoy, edit.company),
      sftDate: toSgtDate(edit.timestamp),
    })
    .where(eq(sftFormsg.responseId, id))
    .returning(LISTED);
  return row ?? null;
}

/** Deletes a record. */
export async function deleteSftRecord(db: Db, id: string): Promise<boolean> {
  const deleted = await db.delete(sftFormsg).where(eq(sftFormsg.responseId, id)).returning({ id: sftFormsg.responseId });
  return deleted.length > 0;
}
