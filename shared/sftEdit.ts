/**
 * Correcting a stored SFT record on the Deposit page.
 * `validateSftEdit` runs in the page and again in `backend/api/sft.ts`, so both agree on a valid correction.
 */

import { isCompany } from './domain.ts';
import { SGT_OFFSET_MS, receivedInSgt } from './dates.ts';

/** Longest text any one answer may be. */
export const MAX_TEXT_CHARS = 200;

/** Free-text answers a clerk may correct, with their labels. */
export const TEXT_FIELDS = [
  { key: 'rank', label: 'Rank' },
  { key: 'name', label: 'Name' },
  { key: 'groupIc', label: 'Group IC' },
  { key: 'pesStatus', label: 'PES status' },
  { key: 'exercises', label: 'Exercises (separate with ;)' },
  { key: 'sfabtType', label: 'SFABT type' },
  { key: 'location', label: 'Training location' },
] as const;

/** The two acknowledgement ticks, with their labels. */
export const ACKNOWLEDGEMENTS = [
  { key: 'informedCommander', label: 'Informed commander' },
  { key: 'windowConfirmed', label: 'Training between 0700h and 2200h' },
] as const;

type TextKey = (typeof TEXT_FIELDS)[number]['key'];
type TickKey = (typeof ACKNOWLEDGEMENTS)[number]['key'];

/** A stored SFT record as `GET /api/sft` returns it. */
export type SftRecord = { [K in TextKey]: string | null } & { [K in TickKey]: boolean | null } & {
  responseId: string;
  timestamp: string;
  sftDate: string | null;
  company: string | null;
};

/** The editor's form: text answers, company, Singapore `YYYY-MM-DDTHH:MM` and ticks. */
export type SftEditForm = { [K in TextKey]: string } & { [K in TickKey]: boolean } & {
  company: string;
  submittedAt: string;
};

/** The columns a valid correction writes. */
export type SftEditValue = { [K in TextKey]: string | null } & { [K in TickKey]: boolean } & {
  company: string | null;
  timestamp: string;
};

type Check<T> = { value: T } | { error: string };

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A Singapore-local `YYYY-MM-DDTHH:MM` as epoch ms, or null when not a real time. */
function sgtInstant(value: unknown): number | null {
  const match = typeof value === 'string' ? LOCAL_TIME.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(utc);
  // Date.UTC rolls 30 Feb into March; a real date survives the round trip.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return utc - SGT_OFFSET_MS;
}

/** Trimmed text (null when blank), or why it is refused. */
function checkText(value: unknown, required: boolean): Check<string | null> {
  if (value !== null && value !== undefined && typeof value !== 'string') return { error: 'Must be text.' };
  const text = (value ?? '').trim();
  if (text.length > MAX_TEXT_CHARS) return { error: `At most ${MAX_TEXT_CHARS} characters.` };
  if (!text && required) return { error: 'Required.' };
  return { value: text || null };
}

/** A known company or blank. */
function checkCompany(value: unknown): Check<string | null> {
  if (value === null || value === undefined || value === '') return { value: null };
  return isCompany(value) ? { value } : { error: 'Pick one of the companies.' };
}

/** A real Singapore time, not in the future, as an ISO instant. */
function checkTime(value: unknown, now: number): Check<string> {
  const instant = sgtInstant(value);
  if (instant === null) return { error: 'Enter a date and time.' };
  if (instant > now) return { error: 'Cannot be in the future.' };
  return { value: new Date(instant).toISOString() };
}

/** A boolean tick. */
function checkTick(value: unknown): Check<boolean> {
  return typeof value === 'boolean' ? { value } : { error: 'Must be ticked or not.' };
}

/** Checks a correction; the server derives `nameKey`, `unitCoy` and `sftDate` from the result. */
export function validateSftEdit(
  form: unknown,
  now: number,
): { ok: true; value: SftEditValue } | { ok: false; errors: Record<string, string> } {
  if (!form || typeof form !== 'object') return { ok: false, errors: { form: 'Nothing to save.' } };
  const input = form as Record<string, unknown>;
  const checks: Record<string, Check<unknown>> = {
    ...Object.fromEntries(TEXT_FIELDS.map(({ key }) => [key, checkText(input[key], key === 'name')])),
    company: checkCompany(input.company),
    timestamp: checkTime(input.submittedAt, now),
    ...Object.fromEntries(ACKNOWLEDGEMENTS.map(({ key }) => [key, checkTick(input[key])])),
  };
  const errors: Record<string, string> = {};
  const value: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(checks)) {
    // The form names the time `submittedAt`; the column is `timestamp`.
    if ('error' in check) errors[key === 'timestamp' ? 'submittedAt' : key] = check.error;
    else value[key] = check.value;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: value as SftEditValue };
}

/** The editor's starting values for a stored record. */
export function toEditForm(record: SftRecord): SftEditForm {
  const sgt = receivedInSgt(record.timestamp);
  return {
    ...(Object.fromEntries(TEXT_FIELDS.map(({ key }) => [key, record[key] ?? ''])) as { [K in TextKey]: string }),
    company: record.company ?? '',
    submittedAt: sgt ? `${sgt.date}T${sgt.time}` : '',
    ...(Object.fromEntries(ACKNOWLEDGEMENTS.map(({ key }) => [key, record[key] === true])) as { [K in TickKey]: boolean }),
  };
}

/** One table row on the Deposit page's SFT panel. */
export interface SftRow {
  id: string;
  date: string | null;
  time: string;
  who: string;
  company: string;
  groupIc: string;
  location: string;
  search: string;
}

/** Stored records as table rows, in the API's newest-first order. */
export function toSftRows(records: SftRecord[]): SftRow[] {
  return records.map((record) => {
    const sgt = receivedInSgt(record.timestamp);
    const who = [record.rank, record.name].filter(Boolean).join(' ') || '—';
    const company = record.company || '—';
    const groupIc = record.groupIc || '—';
    const location = record.location || '—';
    return {
      id: record.responseId,
      date: record.sftDate,
      time: sgt ? sgt.time : '',
      who,
      company,
      groupIc,
      location,
      search: [who, company, groupIc, location].join(' ').toLowerCase(),
    };
  });
}

/** Rows whose name, company, Group IC or location contain the query; blank keeps all. */
export function filterSftRows<T extends { search: string }>(rows: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  return needle ? rows.filter((row) => row.search.includes(needle)) : rows;
}
