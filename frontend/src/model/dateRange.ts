/**
 * Date-range filtering and the quick-range presets; plain UTC string arithmetic, so a date never
 * drifts with the viewer's timezone. A null bound is open; two nulls mean "everything".
 */

import { addDays, weekdayOf } from '../../../shared/dates.ts';

/** A date range; null on either end is open. */
export interface DateRange {
  from: string | null;
  to: string | null;
}

/** Today in the viewer's own timezone, as `yyyy-MM-dd` ("the last seven days" is local). */
export function isoToday(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Whether a date falls within a range, inclusive; a missing date never does. */
export function withinRange(isoDate: string | null | undefined, from: string | null, to: string | null): boolean {
  if (!isoDate) return false;
  if (from && isoDate < from) return false;
  if (to && isoDate > to) return false;
  return true;
}

/** Every date from `from` to `to` inclusive; [] when a bound is missing or reversed. */
export function eachDay(from: string | null | undefined, to: string | null | undefined): string[] {
  if (!from || !to || to < from) return [];
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  return days;
}

/** The quick-range buttons, in display order. */
export const PRESETS = [
  { name: 'thisWeek', label: 'This week' },
  { name: 'lastWeek', label: 'Last week' },
  { name: 'thisMonth', label: 'This month' },
  { name: 'lastMonth', label: 'Last month' },
  { name: 'all', label: 'All' },
] as const;

export type PresetName = (typeof PRESETS)[number]['name'];

/** A preset as a range measured from `today`; weeks start Monday and "this" ranges stop at today. */
export function resolvePreset(name: string, today: string): DateRange {
  switch (name) {
    case 'thisMonth':
      return { from: firstOfMonth(today), to: today };
    case 'lastMonth': {
      const thisMonthFirst = firstOfMonth(today);
      return { from: addMonths(thisMonthFirst, -1), to: addDays(thisMonthFirst, -1) };
    }
    case 'thisWeek':
      return { from: addDays(today, -weekdayOf(today).index), to: today };
    case 'lastWeek': {
      const thisMonday = addDays(today, -weekdayOf(today).index);
      return { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) };
    }
    default:
      return { from: null, to: null };
  }
}

/** The first day of a date's month, `yyyy-MM-01`. */
export function firstOfMonth(isoDate: string): string {
  return isoDate.slice(0, 7) + '-01';
}

/** Shifts a `yyyy-MM-01` by whole months (may be negative). */
export function addMonths(isoFirst: string, delta: number): string {
  const [year = 0, month = 1] = isoFirst.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(zeroBased / 12);
  const shiftedMonth = zeroBased - shiftedYear * 12;
  return `${shiftedYear}-${String(shiftedMonth + 1).padStart(2, '0')}-01`;
}

/** Every date of the month starting `yyyy-MM-01`. */
export function daysOfMonth(isoFirst: string): string[] {
  const [year = 0, month = 1] = isoFirst.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => isoFirst.slice(0, 8) + String(i + 1).padStart(2, '0'));
}

/** The preset a range came from, measured from `today`, or null for a hand-picked span. */
export function matchPreset(from: string | null, to: string | null, today: string): PresetName | null {
  const match = PRESETS.find((preset) => {
    const resolved = resolvePreset(preset.name, today);
    return resolved.from === from && resolved.to === to;
  });
  return match ? match.name : null;
}
