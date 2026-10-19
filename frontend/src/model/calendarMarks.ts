/** Weekend bands and public-holiday lines for a time axis, so a dip reads as "nobody in camp", not "sickness fell". */

import { isWeekend } from '../../../shared/dates.ts';
import type { Holiday } from '../../../shared/settings/defaults.ts';
import { eachDay, withinRange } from './dateRange.ts';

/** A run of consecutive weekend days. */
export interface Band {
  from: string;
  to: string;
}

/** The holidays inside a range, inclusive. */
export function holidaysIn(holidays: Holiday[], fromIso: string | null, toIso: string | null): Holiday[] {
  return holidays.filter((holiday) => withinRange(holiday.date, fromIso, toIso));
}

/** One band per Saturday-Sunday run in a range (clipped at its edges), so a chart draws one rectangle. */
export function weekendBands(fromIso: string | null | undefined, toIso: string | null | undefined): Band[] {
  const bands: Band[] = [];
  let current: Band | null = null;
  for (const day of eachDay(fromIso, toIso)) {
    if (!isWeekend(day)) {
      current = null;
    } else if (current) {
      current.to = day;
    } else {
      current = { from: day, to: day };
      bands.push(current);
    }
  }
  return bands;
}
