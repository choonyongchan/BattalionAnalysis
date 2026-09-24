/**
 * One-time import of the retired Google Sheet's history into Neon.
 *
 * Reads a CSV export of each tab (File → Download → CSV, once per tab) from one directory,
 * matching each file by the tab name it ends with, e.g. `Battalion - Strength Data.csv`.
 * Parade states already in Neon win: a submission whose `parade_response_id` exists is left
 * alone, children and all. FormSG responses dedupe on `Response ID`. Re-running inserts
 * nothing new.
 *
 * The message-body column of "Parade State Responses" and both NRIC columns are never
 * read. Output is counts and row numbers only, never cell contents.
 *
 * Each Sheet value is stored so that `lib/dashboard.ts` rebuilds the same cell the Sheet
 * held: `platoon` becomes `unit_label`, `reason` becomes `duty_type` verbatim, and the 999
 * `num_days` sentinel becomes `is_permanent`.
 *
 * Holidays and rotations are not imported: they are settings now, edited under
 * Settings → Calendar.
 *
 * Usage:  bun --env-file=.env.local scripts/import-sheet.ts <csv-dir> [--dry-run]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from '../db/index.ts';
import {
  commandRosterRows,
  paradeSubmissions,
  personnelRows,
  reportSickFormsg,
  strengthRows,
} from '../db/schema.ts';
import { IMPORTED_MODEL, UNTIMED_MODEL } from '../lib/dashboard.ts';
import { COMPANIES, REASON_CATEGORIES, SESSIONS, normaliseFourD, normaliseName } from '../lib/domain.ts';
import { mapSubmission } from '../lib/formsg/map.ts';

/** One CSV row keyed by header. */
export type SheetRow = Record<string, string>;

/** The `num_days` the Sheet wrote for a permanent status. */
const PERM_STATUS_NUM_DAYS = 999;

/** Singapore is UTC+8 all year. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Strength `unit_type`s the Sheet used; `COMMAND_ELEMENT` is a named sub-unit in Neon. */
const UNIT_TYPES: Record<string, string> = {
  Company: 'Company',
  HQ: 'HQ',
  PLATOON: 'PLATOON',
  SUBUNIT: 'SUBUNIT',
  COMMAND_ELEMENT: 'SUBUNIT',
};

/** The byte-order mark some CSV exports start with. */
const BOM = String.fromCharCode(0xfeff);

/** FormSG export columns that are not question answers. */
const FORMSG_ENVELOPE = new Set(['Timestamp', 'Response ID', 'Download Status']);

/**
 * Parses RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes.
 *
 * @param text The file contents.
 * @returns Rows of cells, with a trailing blank line dropped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.startsWith(BOM) ? text.slice(1) : text;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/**
 * Parses CSV into records keyed by the (trimmed) header row.
 *
 * @param text The file contents.
 * @returns One record per data row; a short row's missing cells read as ''.
 */
export function csvRecords(text: string): SheetRow[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const names = header.map((name) => name.trim());
  return rows
    .filter((row) => row.some((cell) => cell.trim() !== ''))
    .map((row) => Object.fromEntries(names.map((name, i) => [name, (row[i] ?? '').trim()])));
}

/** Month abbreviations in FormSG's export timestamps, e.g. `07 May 2026 19:21:00`. */
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Reads the day, month and year out of a day-first date: `d/M/yyyy` or `d Mon yyyy`.
 *
 * @param text The trimmed cell.
 * @returns `[day, month, year]` as strings, or null.
 */
function dayFirstParts(text: string): [string, string, string] | null {
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(text);
  if (slashed) return [slashed[1]!, slashed[2]!, slashed[3]!];
  const named = /^(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{4})\b/.exec(text);
  const month = named ? MONTHS.indexOf(named[2]!.toLowerCase()) + 1 : 0;
  return named && month ? [named[1]!, String(month), named[3]!] : null;
}

/**
 * Reads a date cell as ISO `yyyy-MM-dd`.
 *
 * Accepts ISO (what the parser wrote), the day-first `d/M/yyyy` a Singapore-locale Sheet
 * displays, and FormSG's `d Mon yyyy`. Anything else is null, so an ambiguous format is
 * rejected rather than guessed.
 *
 * @param value The cell.
 * @returns The date, or null.
 */
export function sheetDate(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parts = dayFirstParts(text);
  if (!parts) return null;
  const [d, m, y] = parts;
  if (Number(m) > 12 || Number(d) > 31) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Reads a Sheet timestamp, which is Singapore-local wall time, as a UTC ISO instant.
 *
 * @param value e.g. `2026-06-22 08:15:23`, `22/06/2026 8:15:23` or `22 Jun 2026 08:15:23`.
 * @returns The instant, or null when the date part is unreadable.
 */
export function sheetTimestamp(value: string | undefined): string | null {
  const date = sheetDate(value);
  if (!date) return null;
  const time = /[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(value ?? '');
  const [h, m, s] = time ? [Number(time[1]), Number(time[2]), Number(time[3] ?? 0)] : [0, 0, 0];
  const utc = Date.parse(`${date}T00:00:00Z`) + ((h * 60 + m) * 60 + s) * 1000 - SGT_OFFSET_MS;
  return new Date(utc).toISOString();
}

/**
 * Reads a whole-number cell.
 *
 * @param value The cell.
 * @returns The number, or null when blank or not a whole number.
 */
function sheetInt(value: string | undefined): number | null {
  const text = (value ?? '').trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

/**
 * Reads a TRUE/FALSE cell.
 *
 * @param value The cell.
 * @returns The boolean, or null when blank.
 */
function sheetBool(value: string | undefined): boolean | null {
  const text = (value ?? '').trim().toUpperCase();
  if (text === 'TRUE') return true;
  if (text === 'FALSE') return false;
  return null;
}

/**
 * A blank cell as null.
 *
 * @param value The cell.
 * @returns The trimmed text, or null.
 */
function orNull(value: string | undefined): string | null {
  const text = (value ?? '').trim();
  return text === '' ? null : text;
}

/**
 * Splits a `parade_response_id` into the submission it names.
 *
 * The id, not the row's own date cell, is the source of truth: it is always ISO.
 *
 * @param id e.g. `Archer_2026-06-22_FPS`.
 * @returns The parts, or null when the company, date or session is not one Neon accepts.
 */
export function splitResponseId(id: string): { company: string; date: string; session: string } | null {
  const match = /^([^_]+)_(\d{4}-\d{2}-\d{2})_([A-Z]+)$/.exec(id.trim());
  if (!match) return null;
  const [, company, date, session] = match;
  if (!COMPANIES.includes(company as never) || !SESSIONS.includes(session as never)) return null;
  return { company: company!, date: date!, session: session! };
}

/**
 * Maps a Strength Data row.
 *
 * @param row The Sheet row.
 * @returns The insert, or null when its totals or unit type are unusable.
 */
export function mapStrength(row: SheetRow): Record<string, unknown> | null {
  const unitType = UNIT_TYPES[row.unit_type ?? ''];
  const totalStrength = sheetInt(row.total_strength);
  const totalPresent = sheetInt(row.total_present);
  if (!unitType || totalStrength === null || totalPresent === null) return null;
  return {
    paradeResponseId: row.parade_response_id,
    unitLabel: orNull(row.platoon) ?? 'Company',
    unitType,
    totalStrength,
    totalPresent,
    officerStrength: sheetInt(row.officer_strength),
    officerPresent: sheetInt(row.officer_present),
    wospecStrength: sheetInt(row.wospec_strength),
    wospecPresent: sheetInt(row.wospec_present),
    enlisteeStrength: sheetInt(row.enlistee_strength),
    enlisteePresent: sheetInt(row.enlistee_present),
  };
}

/**
 * Maps a Personnel Data row.
 *
 * @param row The Sheet row.
 * @returns The insert, or null when it has no name or no known reason category.
 */
export function mapPersonnel(row: SheetRow): Record<string, unknown> | null {
  const name = orNull(row.name);
  if (!name || !REASON_CATEGORIES.includes(row.reason_category as never)) return null;
  const numDays = sheetInt(row.num_days);
  const isPermanent = numDays === PERM_STATUS_NUM_DAYS;
  return {
    paradeResponseId: row.parade_response_id,
    unitLabel: orNull(row.platoon) ?? 'Company',
    reasonCategory: row.reason_category,
    fourD: normaliseFourD(row.four_d),
    rank: orNull(row.rank),
    name,
    nameKey: normaliseName(name),
    dutyType: orNull(row.reason),
    numDays: isPermanent || numDays === null || numDays < 0 ? null : numDays,
    isPermanent,
    startDate: sheetDate(row.start_date),
    endDate: sheetDate(row.end_date),
    inCamp: sheetBool(row.in_camp),
    location: orNull(row.location),
  };
}

/**
 * Maps a Command Roster row; `PDS3` becomes role `PDS` of unit `3`.
 *
 * @param row The Sheet row.
 * @returns The insert, or null when the role is not a known appointment.
 */
export function mapRoster(row: SheetRow): Record<string, unknown> | null {
  const role = /^(CDO|CDS|COS|PDS)\s*(\d*)$/.exec((row.role ?? '').trim().toUpperCase());
  if (!role || (role[1] === 'PDS') !== (role[2] !== '')) return null;
  const name = orNull(row.name);
  return {
    paradeResponseId: row.parade_response_id,
    roleKind: role[1],
    unitLabel: role[2] || null,
    rank: orNull(row.rank),
    name,
    nameKey: name ? normaliseName(name) : null,
    isVacant: false,
  };
}

/** One parade state's rows, ready for a single `db.batch`. */
export interface ParadeGroup {
  submission: Record<string, unknown>;
  strength: Array<Record<string, unknown>>;
  personnel: Array<Record<string, unknown>>;
  roster: Array<Record<string, unknown>>;
}

/** What happened to each Sheet row. */
export interface Tally {
  read: number;
  rejected: number[];
}

/**
 * Groups the three parade-state tabs by submission.
 *
 * A row whose id names no importable submission, or that its mapper rejects, is counted
 * by its CSV row number (header = 1) and skipped.
 *
 * @param tabs The three tabs' rows, plus the "Parade State Responses" rows for filing times.
 * @returns The groups, and a tally per tab.
 */
export function groupParadeStates(tabs: {
  strength: SheetRow[];
  personnel: SheetRow[];
  roster: SheetRow[];
  responses: SheetRow[];
}): { groups: Map<string, ParadeGroup>; tallies: Record<string, Tally> } {
  const filedAt = new Map<string, string>();
  for (const row of tabs.responses) {
    const at = sheetTimestamp(row.Timestamp);
    if (row.parade_response_id && at) filedAt.set(row.parade_response_id.trim(), at);
  }

  const groups = new Map<string, ParadeGroup>();
  const groupFor = (id: string): ParadeGroup | null => {
    const existing = groups.get(id);
    if (existing) return existing;
    const parts = splitResponseId(id);
    if (!parts) return null;
    const at = filedAt.get(id);
    const group: ParadeGroup = {
      submission: {
        paradeResponseId: id,
        ...parts,
        model: at ? IMPORTED_MODEL : UNTIMED_MODEL,
        extractedAt: at ?? `${parts.date}T00:00:00+08:00`,
      },
      strength: [],
      personnel: [],
      roster: [],
    };
    groups.set(id, group);
    return group;
  };

  const tallies: Record<string, Tally> = {};
  const keys = ['strength', 'personnel', 'roster'] as const;
  const mappers = { strength: mapStrength, personnel: mapPersonnel, roster: mapRoster } as const;
  /** CSV row numbers grouped under each id, so a dropped group's rows are reported too. */
  const rowNumbers = new Map<string, Array<[(typeof keys)[number], number]>>();
  for (const key of keys) {
    const tally: Tally = { read: 0, rejected: [] };
    tabs[key].forEach((row, index) => {
      tally.read++;
      const id = (row.parade_response_id ?? '').trim();
      const mapped = mappers[key]({ ...row, parade_response_id: id });
      const group = mapped ? groupFor(id) : null;
      if (!mapped || !group) tally.rejected.push(index + 2);
      else {
        group[key].push(mapped);
        rowNumbers.set(id, [...(rowNumbers.get(id) ?? []), [key, index + 2]]);
      }
    });
    tallies[key] = tally;
  }

  // A submission with no Company roll-up would chart as zero strength; the parser refuses
  // those, so the import does too, and reports every row it drops with them.
  for (const [id, group] of groups) {
    if (group.strength.some((row) => row.unitType === 'Company')) continue;
    groups.delete(id);
    for (const [key, rowNumber] of rowNumbers.get(id) ?? []) tallies[key]!.rejected.push(rowNumber);
  }
  for (const key of keys) tallies[key]!.rejected.sort((a, b) => a - b);
  return { groups, tallies };
}

/**
 * Maps a "Report Sick FormSG Responses" row through the webhook's own mapper.
 *
 * @param row The Sheet row, whose headers are FormSG's question titles.
 * @returns The insert, or null without a response id or a readable timestamp.
 */
export function mapFormSg(row: SheetRow): Record<string, unknown> | null {
  const submittedAt = sheetTimestamp(row.Timestamp);
  const submissionId = orNull(row['Response ID']);
  if (!submittedAt || !submissionId) return null;
  const responses = Object.entries(row)
    .filter(([question]) => !FORMSG_ENVELOPE.has(question))
    .map(([question, answer]) => ({ question, answer }));
  return mapSubmission({ submissionId, submittedAt, responses }).row;
}

/**
 * Maps every row of a flat tab, tallying rejections by CSV row number.
 *
 * @param rows The Sheet rows.
 * @param map The row mapper.
 * @returns The inserts and the tally.
 */
export function mapAll(
  rows: SheetRow[],
  map: (row: SheetRow) => Record<string, unknown> | null,
): { values: Array<Record<string, unknown>>; tally: Tally } {
  const tally: Tally = { read: rows.length, rejected: [] };
  const values: Array<Record<string, unknown>> = [];
  rows.forEach((row, index) => {
    const mapped = map(row);
    if (mapped) values.push(mapped);
    else tally.rejected.push(index + 2);
  });
  return { values, tally };
}

/**
 * Reads the CSV export of one tab from the directory, if present.
 *
 * @param dir The export directory.
 * @param tab The tab name the file name ends with.
 * @returns The rows, or [] when there is no such file.
 */
function readTab(dir: string, tab: string): SheetRow[] {
  const file = readdirSync(dir).find((name) => name.toLowerCase().endsWith(`${tab.toLowerCase()}.csv`));
  if (!file) {
    console.log(`  (no "${tab}" CSV found; skipped)`);
    return [];
  }
  return csvRecords(readFileSync(join(dir, file), 'utf8'));
}

/**
 * Prints one tab's outcome without printing any of its contents.
 *
 * @param tab The tab name.
 * @param tally Rows read and rejected.
 * @param inserted Rows inserted, or null on a dry run.
 */
function report(tab: string, tally: Tally, inserted: number | null): void {
  const rejected = tally.rejected.length
    ? `, rejected ${tally.rejected.length} (rows ${tally.rejected.slice(0, 20).join(', ')}${tally.rejected.length > 20 ? ', ...' : ''})`
    : '';
  const done = inserted === null ? '' : `, inserted ${inserted}`;
  console.log(`${tab}: read ${tally.read}${rejected}${done}`);
}

/**
 * Inserts rows in chunks, skipping conflicts, and counts what was new.
 *
 * @param db The owner handle.
 * @param table The target table.
 * @param values The rows.
 * @returns How many were inserted.
 */
async function insertNew(db: Db, table: any, values: Array<Record<string, unknown>>): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < values.length; i += 200) {
    const rows = (await db.insert(table).values(values.slice(i, i + 200)).onConflictDoNothing().returning()) as unknown[];
    inserted += rows.length;
  }
  return inserted;
}

/**
 * Writes the parade-state groups whose submission is not already in Neon.
 *
 * @param db The owner handle.
 * @param groups The groups.
 * @returns How many submissions were inserted.
 */
async function insertParadeStates(db: Db, groups: Map<string, ParadeGroup>): Promise<number> {
  const existing = new Set(
    (await db.select({ id: paradeSubmissions.paradeResponseId }).from(paradeSubmissions)).map((r) => r.id),
  );
  let inserted = 0;
  for (const [id, group] of groups) {
    if (existing.has(id)) continue;
    const children: any[] = [
      group.strength.length && db.insert(strengthRows).values(group.strength as any),
      group.personnel.length && db.insert(personnelRows).values(group.personnel as any),
      group.roster.length && db.insert(commandRosterRows).values(group.roster as any),
    ].filter(Boolean);
    await db.batch([db.insert(paradeSubmissions).values(group.submission as any), ...children] as any);
    inserted++;
  }
  return inserted;
}

/**
 * Runs the import.
 *
 * @throws {Error} If the directory argument is missing, or a write fails.
 */
async function main(): Promise<void> {
  const dir = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');
  if (!dir) throw new Error('Usage: bun --env-file=.env.local scripts/import-sheet.ts <csv-dir> [--dry-run]');

  const { groups, tallies } = groupParadeStates({
    strength: readTab(dir, 'Strength Data'),
    personnel: readTab(dir, 'Personnel Data'),
    roster: readTab(dir, 'Command Roster'),
    responses: readTab(dir, 'Parade State Responses'),
  });
  const formSg = mapAll(readTab(dir, 'Report Sick FormSG Responses'), mapFormSg);

  let db: Db | null = null;
  if (!dryRun) db = (await import('../db/index.ts')).getDb();

  report('Strength Data', tallies.strength!, null);
  report('Personnel Data', tallies.personnel!, null);
  report('Command Roster', tallies.roster!, null);
  console.log(`Parade submissions: ${groups.size} importable${db ? `, inserted ${await insertParadeStates(db, groups)}` : ''}`);
  report('Report Sick FormSG Responses', formSg.tally, db && (await insertNew(db, reportSickFormsg, formSg.values)));
  if (dryRun) console.log('Dry run: nothing was written.');
}

if (import.meta.main) await main();
