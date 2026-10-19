/**
 * Collapses daily parade-state rows into episodes: one per soldier per continuous absence.
 * Duration is reported, never derived: the stated day count and the date span travel side by side,
 * and `disagreement` flags when they differ.
 */

import { classify, extractSymptoms, isDuty, type DutyClass } from './classify.ts';
import { PERM_STATUS_NUM_DAYS } from '../../../shared/domain.ts';
import type { PersonnelRow } from '../../../shared/dashboard.ts';
import { identityOf } from '../../../shared/identity.ts';
import { addDays, inclusiveDaySpan, isoToUtcMs, weekdayOf } from '../../../shared/dates.ts';
import type { Holiday } from '../../../shared/settings/defaults.ts';
import { withinRange } from './dateRange.ts';
import { toIsoDate, toNumber, toText } from '../../../shared/values.ts';

/** Where an episode's day count came from, strongest claim first. */
export type DaysSource = 'stated' | 'span' | 'observed';

/** One soldier's continuous spell in one duty class. */
export interface Episode {
  key: string;
  dutyClass: DutyClass;
  fourD: string;
  name: string;
  rank: string;
  company: string;
  platoon: string;
  startDate: string | null;
  endDate: string | null;
  paradeDates: string[];
  observedDays: number;
  statedDays: number | null;
  spanDays: number | null;
  permanent: boolean;
  daysLost: number;
  daysLostSource: DaysSource;
  disagreement: boolean;
  reasons: string[];
  symptoms: string[];
  rowCount: number;
}

/** Groups rows sharing a stated start date; rows without one split into runs at gaps of more than a day. */
function groupIntoEpisodes(rows: PersonnelRow[]): PersonnelRow[][] {
  const dated = new Map<string, PersonnelRow[]>();
  const undated: PersonnelRow[] = [];
  for (const row of rows) {
    const start = toIsoDate(row.startDate);
    if (!start) undated.push(row);
    else if (dated.has(start)) dated.get(start)!.push(row);
    else dated.set(start, [row]);
  }

  const groups = Array.from(dated.values());
  let run: PersonnelRow[] = [];
  let previousDate: string | null = null;
  for (const row of undated) {
    const date = toIsoDate(row.date);
    if (run.length > 0 && (!date || !previousDate || inclusiveDaySpan(previousDate, date) > 2)) {
      groups.push(run);
      run = [];
    }
    run.push(row);
    previousDate = date ?? previousDate;
  }
  if (run.length > 0) groups.push(run);
  return groups;
}

/** The last non-blank value of a field across date-sorted rows (later records are better informed). */
function latestValue(rows: PersonnelRow[], field: keyof PersonnelRow): string {
  let value = '';
  for (const row of rows) {
    const candidate = toText(row[field]);
    if (candidate !== '') value = candidate;
  }
  return value;
}

/** The day count to report: stated, else the date span, else parade days observed. */
function chooseDuration(statedDays: number | null, spanDays: number | null, observedDays: number): { days: number; source: DaysSource } {
  if (statedDays !== null && statedDays > 0) return { days: statedDays, source: 'stated' };
  if (spanDays !== null && spanDays > 0) return { days: spanDays, source: 'span' };
  return { days: observedDays, source: 'observed' };
}

/** Builds one episode from a date-sorted group of rows. */
function buildEpisode(key: string, dutyClass: DutyClass, rows: PersonnelRow[]): Episode {
  const paradeDates = Array.from(new Set(rows.map((row) => toIsoDate(row.date)).filter((date) => date !== null))).sort();
  const statedStart = toIsoDate(rows[0]?.startDate);
  const statedEnd = toIsoDate(latestValue(rows, 'endDate'));
  const startDate = statedStart ?? paradeDates[0] ?? null;
  const endDate = statedEnd ?? paradeDates[paradeDates.length - 1] ?? null;

  const rawStatedDays = toNumber(latestValue(rows, 'numDays'));
  const permanent = rawStatedDays === PERM_STATUS_NUM_DAYS;
  const statedDays = permanent ? null : rawStatedDays;
  const spanDays = statedStart && statedEnd ? inclusiveDaySpan(statedStart, statedEnd) : null;
  const duration = chooseDuration(statedDays, spanDays, paradeDates.length);
  const reasons = Array.from(new Set(rows.map((row) => toText(row.reason)).filter((text) => text !== '')));

  return {
    key,
    dutyClass,
    fourD: latestValue(rows, 'fourD'),
    name: latestValue(rows, 'name'),
    rank: latestValue(rows, 'rank'),
    company: latestValue(rows, 'company'),
    platoon: latestValue(rows, 'platoon'),
    startDate,
    endDate,
    paradeDates,
    observedDays: paradeDates.length,
    statedDays,
    spanDays,
    permanent,
    daysLost: duration.days,
    daysLostSource: duration.source,
    disagreement: statedDays !== null && spanDays !== null && statedDays !== spanDays,
    reasons,
    symptoms: Array.from(new Set(reasons.flatMap((reason) => extractSymptoms(reason)))),
    rowCount: rows.length,
  };
}

/** Orders rows by parade date, then session. */
function byParadeDate(a: PersonnelRow, b: PersonnelRow): number {
  const dateA = toIsoDate(a.date);
  const dateB = toIsoDate(b.date);
  if (dateA && dateB && dateA !== dateB) return isoToUtcMs(dateA) - isoToUtcMs(dateB);
  return toText(a.session).localeCompare(toText(b.session));
}

/** Episodes from personnel rows, sorted by start date then name; rows naming nobody are skipped. */
export function buildEpisodes(rows: PersonnelRow[]): Episode[] {
  const byPersonAndClass = new Map<string, { key: string; dutyClass: DutyClass; rows: PersonnelRow[] }>();
  for (const row of rows) {
    const { key } = identityOf(row);
    if (key === '') continue;
    const dutyClass = classify(row);
    const groupKey = key + '|' + dutyClass;
    const bucket = byPersonAndClass.get(groupKey) ?? { key, dutyClass, rows: [] };
    bucket.rows.push(row);
    byPersonAndClass.set(groupKey, bucket);
  }

  const episodes = Array.from(byPersonAndClass.values()).flatMap((bucket) =>
    groupIntoEpisodes(bucket.rows.slice().sort(byParadeDate)).map((group) =>
      buildEpisode(bucket.key, bucket.dutyClass, group.slice().sort(byParadeDate)),
    ),
  );
  return episodes.sort(
    (a, b) => String(a.startDate).localeCompare(String(b.startDate)) || a.name.localeCompare(b.name),
  );
}

/** Whether the soldier was listed on any parade inside the range (so a spell begun earlier still counts). */
export function activeWithin(episode: Episode, from: string | null, to: string | null): boolean {
  return episode.paradeDates.some((date) => withinRange(date, from, to));
}

/** Starts per weekday (Monday first), and how many start beside a weekend or public holiday. */
export function startsByWeekday(
  episodes: Episode[],
  dutyClass: DutyClass | DutyClass[],
  holidays: Holiday[],
): { counts: number[]; nextToBreak: number; total: number } {
  const holidayDates = new Set(holidays.map((holiday) => holiday.date));
  const counts = [0, 0, 0, 0, 0, 0, 0];
  let nextToBreak = 0;
  const starts = episodes.filter((episode) => isDuty(dutyClass, episode.dutyClass) && episode.startDate);
  for (const { startDate } of starts) {
    const { index } = weekdayOf(startDate!);
    counts[index] = (counts[index] ?? 0) + 1;
    const besideHoliday = holidayDates.has(addDays(startDate!, 1)) || holidayDates.has(addDays(startDate!, -1));
    if (index === 0 || index === 4 || besideHoliday) nextToBreak += 1;
  }
  return { counts, nextToBreak, total: starts.length };
}
