/**
 * Weekend and public-holiday annotations for a time axis.
 *
 * Every trend line in the dashboard gets a translucent band behind Saturdays and Sundays
 * and a vertical line on public holidays, so a dip in the line reads as "nobody was in
 * camp" rather than "sickness collapsed". Public holidays come from the Calendar
 * settings — a battalion that has not set any up still gets a working dashboard, just
 * without holiday lines, so nothing here may throw on an empty or missing feed.
 *
 * Not using date-fns here: weekend grouping is a single pass over consecutive calendar
 * days, which `dates.js`'s `isWeekend` already answers per-day in UTC. date-fns adds
 * nothing a day-by-day scan does not already give for free.
 *
 * Every function here is pure.
 */

import { isWeekend } from './dates.js';
import { eachDay, withinRange } from './dateRange.js';
import { toIsoDate, toText } from './values.js';

/**
 * Parses raw "Public Holidays" rows into sorted date/name pairs.
 *
 * A row with an unparseable date is dropped rather than charted at a wrong or missing
 * position. A blank name falls back to a generic label; the Calendar settings require a
 * name, so this only covers a row from elsewhere.
 * @param {Array<!Object>} rows Raw records with `date` and `name` cells; may be `[]` or
 *     missing when the tab does not exist.
 * @returns {Array<{date: string, name: string}>} Holidays sorted by date.
 */
export function toHolidays(rows) {
  return (rows || [])
    .map((row) => {
      const date = toIsoDate(row.date);
      if (!date) {
        return null;
      }
      return { date, name: toText(row.name) || 'Public holiday' };
    })
    .filter((holiday) => holiday !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Filters holidays to those falling within a range, inclusive of both ends.
 * @param {Array<{date: string, name: string}>} holidays Holidays, as from `toHolidays`.
 * @param {?string} fromIso Inclusive lower bound, or null for open.
 * @param {?string} toIso Inclusive upper bound, or null for open.
 * @returns {Array<{date: string, name: string}>} The holidays inside the range.
 */
export function holidaysIn(holidays, fromIso, toIso) {
  return holidays.filter((holiday) => withinRange(holiday.date, fromIso, toIso));
}

/**
 * Groups the weekend days in a range into contiguous bands.
 *
 * One entry per Saturday-Sunday run, not one per day, so a chart draws a single
 * rectangle rather than two abutting ones with a seam down the middle. A range that
 * starts or ends mid-weekend yields a shorter band at that edge rather than being
 * skipped or padded past the range.
 * @param {?string} fromIso Inclusive first day, ISO 'yyyy-MM-dd'.
 * @param {?string} toIso Inclusive last day, ISO 'yyyy-MM-dd'.
 * @returns {Array<{from: string, to: string}>} Weekend bands, in order.
 */
export function weekendBands(fromIso, toIso) {
  const bands = [];
  let current = null;
  eachDay(fromIso, toIso).forEach((day) => {
    if (!isWeekend(day)) {
      current = null;
      return;
    }
    if (current) {
      current.to = day;
    } else {
      current = { from: day, to: day };
      bands.push(current);
    }
  });
  return bands;
}
