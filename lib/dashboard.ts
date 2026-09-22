/**
 * The dashboard's read of Neon, shaped as the tabs the Sheet-era feed returned.
 *
 * `src/data/feed.js` maps `{ [tabName]: values[][] }` (header row first) to records by header
 * name, and every number in `src/model/` is computed from those records. Answering in the
 * same shape, with Neon columns aliased to the old Sheet headers, means the switch from the
 * Sheet changes where the data comes from and nothing about what is computed from it.
 *
 * Headers come from `src/data/tabs.js`, the dashboard's own list of what it reads, so a
 * column can only reach the browser if the dashboard asks for it. NRIC columns do not exist
 * in Neon, and `raw_messages.body` is neither selected here nor readable by the role this
 * runs as (`db/grants-dashboard.sql`).
 */
import { asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  commandRosterRows,
  paradeSubmissions,
  personnelRows,
  publicHolidays,
  rawMessages,
  reportSickFormsg,
  rotations,
  strengthRows,
} from '../db/schema.ts';
import { PERM_STATUS_NUM_DAYS } from '../src/model/domain.js';
import {
  FORMSG_HEADERS,
  HOLIDAY_HEADERS,
  PERSONNEL_HEADERS,
  ROSTER_HEADERS,
  ROTATION_HEADERS,
  STRENGTH_HEADERS,
  SUBMISSION_HEADERS,
  TABS as SHEET_TABS,
} from '../src/data/tabs.js';
import { HQ_LABEL, PLATOON_LABEL, cleanText } from './domain.ts';

/** One record keyed by Sheet header. */
export type Row = Record<string, unknown>;

/** Tab name to values, header row first: the reply `src/data/feed.js` reads. */
export type Tabs = Record<string, unknown[][]>;

/** The tab names, typed: the JSDoc on the browser module does not carry through. */
const TABS = SHEET_TABS as Record<
  'STRENGTH' | 'PERSONNEL' | 'ROSTER' | 'FORMSG' | 'SUBMISSIONS' | 'HOLIDAYS' | 'ROTATIONS',
  string
>;

/** `parade_submissions.model` on a submission `scripts/import-sheet.ts` brought in from the Sheet. */
export const IMPORTED_MODEL = 'sheet';

/** The same, for one the Sheet had no filing Timestamp for: it is left out of filing times. */
export const UNTIMED_MODEL = 'sheet:untimed';

/** Singapore is UTC+8 all year. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The platoon the dashboard reads out of a unit label.
 *
 * `src/model/platoon.js` accepts `1`–`4` and `HQ` as a stated platoon and infers one from the
 * 4D number otherwise, so a numbered block becomes its number, a headquarters block `HQ`, the
 * company roll-up blank, and any named sub-unit (SIG, MED, ...) passes through as written.
 *
 * @param unitLabel The block label: `PLATOON 1`, `PL2`, `COY HQ`, `Company`, `SIG`, or the
 *   bare `3` the Sheet stored.
 * @returns The platoon cell.
 */
export function platoonOf(unitLabel: string | null | undefined): string {
  const label = cleanText(unitLabel ?? '').toUpperCase().trim();
  if (label === '' || label === 'COMPANY') return '';
  if (HQ_LABEL.test(label)) return 'HQ';
  if (PLATOON_LABEL.test(label) || /^\d+$/.test(label)) return label.replace(/\D/g, '');
  return label;
}

/**
 * The roster role the dashboard reads: `CDO`, `CDS`, `COS`, or `PDS1`–`PDS4`.
 *
 * @param roleKind The appointment.
 * @param unitLabel The PDS's sub-unit, e.g. `1` or `SIG`; ignored for other roles.
 * @returns The role cell.
 */
export function rosterRole(roleKind: string, unitLabel: string | null | undefined): string {
  if (roleKind !== 'PDS') return roleKind;
  return 'PDS' + cleanText(unitLabel ?? '').toUpperCase().replace(/\s+/g, '');
}

/**
 * The single `reason` text the Sheet held, rebuilt from the parsed parts.
 *
 * `PERM` is kept in front because `src/model/statusBuckets.js` and `quality.js` recognise a
 * permanent status by that word.
 *
 * @param row The duty parts of one personnel row.
 * @returns e.g. `MC`, `EXCUSE (HEAVY LOADS)`, `PERM EXCUSE (KNEELING)`.
 */
export function personnelReason(row: {
  dutyType: string | null;
  subReason: string | null;
  reportSickType: string | null;
  isPermanent: boolean;
}): string {
  const duty = row.dutyType || row.reportSickType || '';
  let text = row.subReason ? (duty ? `${duty} (${row.subReason})` : row.subReason) : duty;
  if (row.isPermanent && !/\bperm/i.test(text)) text = `PERM ${text}`.trim();
  return text;
}

/**
 * The `num_days` cell: the stated count, or the sentinel the Sheet used for a permanent status.
 *
 * @param row The count and permanence of one personnel row.
 * @returns The cell value.
 */
export function personnelNumDays(row: {
  numDays: number | null;
  isPermanent: boolean;
  reasonCategory: string;
}): number | null {
  return row.isPermanent && row.reasonCategory === 'Status' ? PERM_STATUS_NUM_DAYS : row.numDays;
}

/**
 * Renders a Postgres timestamp as Singapore-local `yyyy-MM-ddTHH:mm:ss`, the form the old
 * feed sent and `src/model/values.js` reads the date and time out of.
 *
 * @param value A timestamptz as the driver returns it, e.g. `2026-09-18 00:15:23.5+00`.
 * @returns The local rendering, or '' when blank or unparseable.
 */
export function sgtDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 19);
}

/**
 * Lays records out as a tab: the header row, then each record's cells in header order.
 *
 * @param headers The Sheet headers, in order.
 * @param rows Records keyed by those headers.
 * @returns The tab's values.
 */
export function toTab(headers: string[], rows: Row[]): unknown[][] {
  return [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))];
}

/**
 * Reads the Strength Data tab.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function strengthTab(db: Db): Promise<Row[]> {
  const rows = await db
    .select({
      id: paradeSubmissions.paradeResponseId,
      date: paradeSubmissions.date,
      session: paradeSubmissions.session,
      company: paradeSubmissions.company,
      unitLabel: strengthRows.unitLabel,
      unitType: strengthRows.unitType,
      totalStrength: strengthRows.totalStrength,
      totalPresent: strengthRows.totalPresent,
    })
    .from(strengthRows)
    .innerJoin(paradeSubmissions, eq(strengthRows.paradeResponseId, paradeSubmissions.paradeResponseId))
    .orderBy(asc(paradeSubmissions.date), asc(strengthRows.id));
  return rows.map((r) => ({
    parade_response_id: r.id,
    date: r.date,
    session: r.session,
    company: r.company,
    platoon: platoonOf(r.unitLabel),
    unit_type: r.unitType,
    total_strength: r.totalStrength,
    total_present: r.totalPresent,
  }));
}

/**
 * Reads the Personnel Data tab.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function personnelTab(db: Db): Promise<Row[]> {
  const rows = await db
    .select({
      id: paradeSubmissions.paradeResponseId,
      date: paradeSubmissions.date,
      session: paradeSubmissions.session,
      company: paradeSubmissions.company,
      unitLabel: personnelRows.unitLabel,
      fourD: personnelRows.fourD,
      name: personnelRows.name,
      rank: personnelRows.rank,
      reasonCategory: personnelRows.reasonCategory,
      startDate: personnelRows.startDate,
      endDate: personnelRows.endDate,
      numDays: personnelRows.numDays,
      isPermanent: personnelRows.isPermanent,
      dutyType: personnelRows.dutyType,
      subReason: personnelRows.subReason,
      reportSickType: personnelRows.reportSickType,
      location: personnelRows.location,
    })
    .from(personnelRows)
    .innerJoin(paradeSubmissions, eq(personnelRows.paradeResponseId, paradeSubmissions.paradeResponseId))
    .orderBy(asc(paradeSubmissions.date), asc(personnelRows.id));
  return rows.map((r) => ({
    parade_response_id: r.id,
    date: r.date,
    session: r.session,
    company: r.company,
    platoon: platoonOf(r.unitLabel),
    four_d: r.fourD,
    name: r.name,
    rank: r.rank,
    reason_category: r.reasonCategory,
    start_date: r.startDate,
    end_date: r.endDate,
    num_days: personnelNumDays(r),
    reason: personnelReason(r),
    location: r.location,
  }));
}

/**
 * Reads the Command Roster tab; a vacant appointment is left out, as the Sheet left it out.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function rosterTab(db: Db): Promise<Row[]> {
  const rows = await db
    .select({
      id: paradeSubmissions.paradeResponseId,
      date: paradeSubmissions.date,
      session: paradeSubmissions.session,
      company: paradeSubmissions.company,
      roleKind: commandRosterRows.roleKind,
      unitLabel: commandRosterRows.unitLabel,
      rank: commandRosterRows.rank,
      name: commandRosterRows.name,
    })
    .from(commandRosterRows)
    .innerJoin(paradeSubmissions, eq(commandRosterRows.paradeResponseId, paradeSubmissions.paradeResponseId))
    .where(eq(commandRosterRows.isVacant, false))
    .orderBy(asc(paradeSubmissions.date), asc(commandRosterRows.id));
  return rows.map((r) => ({
    parade_response_id: r.id,
    date: r.date,
    session: r.session,
    company: r.company,
    role: rosterRole(r.roleKind, r.unitLabel),
    rank: r.rank,
    name: r.name,
  }));
}

/**
 * Reads the Report Sick FormSG Responses tab, under FormSG's own question titles.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function formSgTab(db: Db): Promise<Row[]> {
  const rows = await db
    .select({
      timestamp: reportSickFormsg.timestamp,
      rank: reportSickFormsg.rank,
      name: reportSickFormsg.name,
      fourD: reportSickFormsg.fourD,
      unitCoy: reportSickFormsg.unitCoy,
      reportSickType: reportSickFormsg.reportSickType,
      reason: reportSickFormsg.reason,
      symptoms: reportSickFormsg.symptoms,
    })
    .from(reportSickFormsg)
    .orderBy(asc(reportSickFormsg.timestamp));
  return rows.map((r) => ({
    Timestamp: sgtDateTime(r.timestamp),
    RANK: r.rank,
    '[Myinfo] Name': r.name,
    '4D Number (REC Only)': r.fourD,
    'Unit & Coy': r.unitCoy,
    'Report Sick Type': r.reportSickType,
    'Reason for Reporting Sick (Keep Brief)': r.reason,
    'I am experiencing _____________________ symptoms.': r.symptoms,
  }));
}

/**
 * Reads the Parade State Responses tab: when each company filed, and for which parade.
 *
 * The filing time is when its message arrived; a submission imported from the Sheet has no
 * message, so its `extracted_at` carries the Sheet's own Timestamp instead, and one with no
 * Timestamp in the Sheet is left out, as the Sheet left it out.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function submissionsTab(db: Db): Promise<Row[]> {
  const rows = await db
    .select({
      id: paradeSubmissions.paradeResponseId,
      filedAt: sql<string>`coalesce(${rawMessages.receivedAt}, ${paradeSubmissions.extractedAt})`,
    })
    .from(paradeSubmissions)
    .leftJoin(rawMessages, eq(paradeSubmissions.sourceMessageId, rawMessages.id))
    .where(or(isNull(paradeSubmissions.model), ne(paradeSubmissions.model, UNTIMED_MODEL)))
    .orderBy(asc(paradeSubmissions.date));
  return rows.map((r) => ({ Timestamp: sgtDateTime(r.filedAt), parade_response_id: r.id }));
}

/**
 * Reads the Public Holidays tab.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function holidaysTab(db: Db): Promise<Row[]> {
  return db.select({ date: publicHolidays.date, name: publicHolidays.name }).from(publicHolidays).orderBy(asc(publicHolidays.date));
}

/**
 * Reads the Rotations tab.
 *
 * @param db The read-only handle.
 * @returns Records keyed by Sheet header.
 */
async function rotationsTab(db: Db): Promise<Row[]> {
  return db
    .select({ name: rotations.name, start_date: rotations.startDate, end_date: rotations.endDate })
    .from(rotations)
    .orderBy(asc(rotations.startDate));
}

/**
 * Reads every tab the dashboard charts.
 *
 * @param db A handle connected as `dashboard_read`.
 * @returns Tab name to values, header row first.
 */
export async function loadTabs(db: Db): Promise<Tabs> {
  const [strength, personnel, roster, formSg, submissions, holidays, rotationRows] = await Promise.all([
    strengthTab(db),
    personnelTab(db),
    rosterTab(db),
    formSgTab(db),
    submissionsTab(db),
    holidaysTab(db),
    rotationsTab(db),
  ]);
  return {
    [TABS.STRENGTH]: toTab(STRENGTH_HEADERS, strength),
    [TABS.PERSONNEL]: toTab(PERSONNEL_HEADERS, personnel),
    [TABS.ROSTER]: toTab(ROSTER_HEADERS, roster),
    [TABS.FORMSG]: toTab(FORMSG_HEADERS, formSg),
    [TABS.SUBMISSIONS]: toTab(SUBMISSION_HEADERS, submissions),
    [TABS.HOLIDAYS]: toTab(HOLIDAY_HEADERS, holidays),
    [TABS.ROTATIONS]: toTab(ROTATION_HEADERS, rotationRows),
  };
}
