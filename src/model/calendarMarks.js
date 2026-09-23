/**
 * Weekend and public-holiday annotations for a time axis.
 *
 * Every trend line in the dashboard gets a translucent band behind Saturdays and Sundays
 * and a vertical line on public holidays, so a dip in the line reads as "nobody was in
 * camp" rather than "sickness collapsed". Public holidays come from an optional
 * "Public Holidays" tab — a battalion that has not created it still gets a working
 * dashboard, just without holiday lines, so nothing here may throw on an empty or
 * missing feed.
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
 * Official Singapore public-holiday names, keyed by ISO 'yyyy-MM-dd' date.
 *
 * The "Public Holidays" tab is optional and its `name` column is optional too — a
 * battalion may paste only the dates. This map is the fallback: when a row gives a date
 * but no name, `toHolidays` looks the date up here so the chart line still reads
 * "National Day" rather than the generic "Public holiday". A non-blank name in the sheet
 * always wins over this map.
 *
 * Dates are the gazetted Singapore MOM public holidays for calendar years 2025 and 2026,
 * including the in-lieu Monday where a 2026 holiday falls on a Sunday, since a battalion
 * may enter either the actual or the observed date. Extend this map as new years are
 * gazetted; an unknown date simply falls back to the generic label.
 */
const SG_PUBLIC_HOLIDAYS = {
  // 2025
  '2025-01-01': "New Year's Day",
  '2025-01-29': 'Chinese New Year',
  '2025-01-30': 'Chinese New Year',
  '2025-03-31': 'Hari Raya Puasa',
  '2025-04-18': 'Good Friday',
  '2025-05-01': 'Labour Day',
  '2025-05-12': 'Vesak Day',
  '2025-06-07': 'Hari Raya Haji',
  '2025-08-09': 'National Day',
  '2025-10-20': 'Deepavali',
  '2025-12-25': 'Christmas Day',
  // 2026
  '2026-01-01': "New Year's Day",
  '2026-02-17': 'Chinese New Year',
  '2026-02-18': 'Chinese New Year',
  '2026-03-21': 'Hari Raya Puasa',
  '2026-04-03': 'Good Friday',
  '2026-05-01': 'Labour Day',
  '2026-05-27': 'Hari Raya Haji',
  '2026-05-31': 'Vesak Day',
  '2026-06-01': 'Vesak Day', // in lieu — Vesak Day falls on a Sunday
  '2026-08-09': 'National Day',
  '2026-08-10': 'National Day', // in lieu — National Day falls on a Sunday
  '2026-11-08': 'Deepavali',
  '2026-11-09': 'Deepavali', // in lieu — Deepavali falls on a Sunday
  '2026-12-25': 'Christmas Day',
};

/**
 * Parses raw "Public Holidays" rows into sorted date/name pairs.
 *
 * A row with an unparseable date is dropped rather than charted at a wrong or missing
 * position. A blank name is resolved from `SG_PUBLIC_HOLIDAYS` by date, and only falls
 * back to a generic label when that date is not a known Singapore holiday; a non-blank
 * name in the sheet always wins.
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
      const name = toText(row.name);
      if (name !== '') {
        return { date, name };
      }
      return { date, name: SG_PUBLIC_HOLIDAYS[date] || 'Public holiday' };
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
