/**
 * Recently back: who came off MC (last two days) or Light Duty (yesterday), to watch for a relapse.
 * Read from each soldier's latest earlier line, so an extended MC reads its extended end; a soldier
 * still listed on the parade is not back, and a line with no end date is never listed.
 */

import { classify, DUTY_CLASS } from './classify.ts';
import { inclusiveDaySpan } from '../../../shared/dates.ts';
import type { PersonnelRow } from '../../../shared/dashboard.ts';
import { identityOf } from '../../../shared/identity.ts';
import { bucketsFor } from './statusBuckets.ts';
import { toIsoDate, toText } from '../../../shared/values.ts';

/** How many days after its end date each kind stays listed. */
const RECENT_WINDOW_DAYS = { MC: 2, 'Light Duty': 1 } as const;

type Kind = keyof typeof RECENT_WINDOW_DAYS;

/** One soldier just back from one kind of absence. */
export interface RecentReturn {
  key: string;
  rank: string;
  name: string;
  company: string;
  platoon: string;
  kind: Kind;
  reason: string;
  endedOn: string;
  daysBack: number;
}

/** The kind a line belongs to, if the list covers it. */
function kindOf(row: PersonnelRow): Kind | null {
  const dutyClass = classify(row);
  if (dutyClass === DUTY_CLASS.ATT_C) return 'MC';
  if (dutyClass === DUTY_CLASS.STATUS && bucketsFor(row.reason).includes('Light Duty')) return 'Light Duty';
  return null;
}

/** Whether `a` was filed on a later parade than `b`, by date then session. */
function isLater(a: PersonnelRow, b: PersonnelRow): boolean {
  return a.date !== b.date ? a.date > b.date : a.session > b.session;
}

/** Each soldier's latest MC and Light Duty line on or before a date, keyed by identity and kind. */
function latestLines(personnelRows: PersonnelRow[], isoDate: string): Map<string, { key: string; kind: Kind; row: PersonnelRow }> {
  const latest = new Map<string, { key: string; kind: Kind; row: PersonnelRow }>();
  for (const row of personnelRows) {
    const kind = row.date <= isoDate ? kindOf(row) : null;
    const key = kind ? identityOf(row).key : '';
    if (!kind || key === '') continue;
    const seen = latest.get(key + '|' + kind);
    if (!seen || isLater(row, seen.row)) latest.set(key + '|' + kind, { key, kind, row });
  }
  return latest;
}

/** Soldiers just back, by days back, then kind, then name. */
export function recentlyReturned(personnelRows: PersonnelRow[], isoDate: string): RecentReturn[] {
  const rows: RecentReturn[] = [];
  for (const { key, kind, row } of latestLines(personnelRows, isoDate).values()) {
    const endedOn = toIsoDate(row.endDate);
    if (!endedOn || row.date === isoDate) continue;
    const daysBack = inclusiveDaySpan(endedOn, isoDate) - 1;
    if (daysBack < 1 || daysBack > RECENT_WINDOW_DAYS[kind]) continue;
    rows.push({
      key,
      rank: toText(row.rank),
      name: toText(row.name),
      company: row.company,
      platoon: toText(row.platoon),
      kind,
      reason: toText(row.reason),
      endedOn,
      daysBack,
    });
  }
  return rows.sort((a, b) => a.daysBack - b.daysBack || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}
