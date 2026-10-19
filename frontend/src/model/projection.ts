/**
 * Returns to duty: who is back over the coming days, read from the dates the parade state states.
 * Only MC and leave count (MA is a same-day appointment, Others means nothing in common);
 * an absence with no end date is listed with no day back, never a guessed one.
 */

import { classify, DUTY_CLASS, type DutyClass } from './classify.ts';
import { addDays } from '../../../shared/dates.ts';
import type { PersonnelRow } from '../../../shared/dashboard.ts';
import { identityOf } from '../../../shared/identity.ts';
import { toIsoDate, toText } from '../../../shared/values.ts';

/** Days ahead the forward-looking section names by default. */
export const DEFAULT_PROJECTION_DAYS = 7;

/** The duty classes that keep a soldier off parade for dated days. */
const PROJECTED_CLASSES: DutyClass[] = [DUTY_CLASS.ATT_C, DUTY_CLASS.OFF_LEAVE];

/** One soldier on MC or leave, and the day expected back (null when an absence states no end). */
export interface ReturnRow {
  key: string;
  rank: string;
  name: string;
  company: string;
  platoon: string;
  category: string;
  reason: string;
  from: string;
  backOn: string | null;
}

/** A soldier's first row on the parade and every absence interval stated for him. */
type Absence = { row: PersonnelRow; intervals: { start: string; end: string | null }[] };

/** Soldiers on MC or leave on one parade, by company then identity (an MC then leave is one soldier, two intervals). */
function absencesOn(personnelRows: PersonnelRow[], isoDate: string, session: string): Map<string, Map<string, Absence>> {
  const byCompany = new Map<string, Map<string, Absence>>();
  for (const row of personnelRows) {
    if (row.date !== isoDate || row.session !== session || !PROJECTED_CLASSES.includes(classify(row))) continue;
    const { key } = identityOf(row);
    if (key === '') continue;
    const soldiers = byCompany.get(row.company) ?? new Map<string, Absence>();
    const soldier = soldiers.get(key) ?? { row, intervals: [] };
    soldier.intervals.push({ start: toIsoDate(row.startDate) ?? isoDate, end: toIsoDate(row.endDate) });
    soldiers.set(key, soldier);
    byCompany.set(row.company, soldiers);
  }
  return byCompany;
}

/** Soldiers on MC or leave on one parade, soonest back first and open-ended last. */
export function returnsToDuty(personnelRows: PersonnelRow[], isoDate: string, session = 'FPS'): ReturnRow[] {
  const rows: ReturnRow[] = [];
  absencesOn(personnelRows, isoDate, session).forEach((soldiers, company) => {
    soldiers.forEach(({ row, intervals }, key) => {
      const ends = intervals.map((interval) => interval.end);
      const latestEnd = ends.includes(null) ? null : (ends as string[]).sort().pop()!;
      rows.push({
        key,
        rank: toText(row.rank),
        name: toText(row.name),
        company,
        platoon: toText(row.platoon),
        category: toText(row.reasonCategory),
        reason: toText(row.reason),
        from: intervals.map((interval) => interval.start).sort()[0]!,
        backOn: latestEnd === null ? null : addDays(latestEnd, 1),
      });
    });
  });
  return rows.sort(
    (a, b) =>
      Number(a.backOn === null) - Number(b.backOn === null) ||
      String(a.backOn).localeCompare(String(b.backOn)) ||
      a.name.localeCompare(b.name),
  );
}

/** Soldiers already away still away on each coming day: a floor, since new MCs and open absences are not in it. */
export function awayAhead(returns: ReturnRow[], isoDate: string, days: number): { days: string[]; away: number[] } {
  const dated = returns.filter((row) => row.backOn !== null);
  const dates = Array.from({ length: days }, (_, offset) => addDays(isoDate, offset));
  return { days: dates, away: dates.map((day) => dated.filter((row) => row.from <= day && day < row.backOn!).length) };
}
