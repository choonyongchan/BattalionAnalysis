/**
 * Date-range filtering for the dashboard's aggregated views.
 *
 * The shell holds a `dateFrom`/`dateTo` pair; `null` on either end means "open", and
 * `null` on both means "no restriction" — the dashboard's long-standing default of
 * reading everything ingested. These helpers stay DOM-free and string-only so they can
 * be unit-tested and reused by `snapshot()` without pulling in the view layer.
 *
 * Every preset below (`thisWeek`, `lastMonth`, and the rest) is plain day/month
 * arithmetic over `dates.js`'s `addDays` and `weekdayOf`, done in UTC. A date library
 * would work on `Date` objects read in local time, which is exactly the drift this file
 * exists to avoid.
 */

import { addDays, weekdayOf } from './dates.js';

/**
 * Today's date in the viewer's own timezone, as ISO 'yyyy-MM-dd'.
 *
 * Local rather than UTC because the presets answer a human question — "the last seven
 * days" means the last seven days where the reader is standing, not in Greenwich.
 * @returns {string} ISO 'yyyy-MM-dd'.
 */
export function isoToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + month + '-' + day;
}

/**
 * Tests whether an ISO date falls within a range, inclusive of both ends.
 *
 * A `null` bound is treated as open, so `withinRange(d, null, null)` is always true —
 * that is the "All" case, and callers can skip the predicate entirely when they see
 * two nulls.
 * @param {?string} isoDate ISO 'yyyy-MM-dd', or null.
 * @param {?string} from Inclusive lower bound, or null for open.
 * @param {?string} to Inclusive upper bound, or null for open.
 * @returns {boolean} Whether the date is inside the range.
 */
export function withinRange(isoDate, from, to) {
  if (!isoDate) {
    return false;
  }
  if (from && isoDate < from) {
    return false;
  }
  if (to && isoDate > to) {
    return false;
  }
  return true;
}

/**
 * Tests whether a [startIso, endIso] span overlaps a range at all.
 *
 * Used for episodes, which have a duration: an MC that began before the window but
 * runs into it is part of the window's picture, so the test is overlap, not
 * containment. Either range bound may be null (open).
 * @param {?string} startIso Span start, ISO 'yyyy-MM-dd'.
 * @param {?string} endIso Span end, ISO 'yyyy-MM-dd'.
 * @param {?string} from Range lower bound, or null for open.
 * @param {?string} to Range upper bound, or null for open.
 * @returns {boolean} Whether the span touches the range.
 */
export function overlapsRange(startIso, endIso, from, to) {
  const start = startIso || endIso;
  const end = endIso || startIso;
  if (!start || !end) {
    return false;
  }
  if (to && start > to) {
    return false;
  }
  if (from && end < from) {
    return false;
  }
  return true;
}

/**
 * Every ISO date from `from` to `to`, inclusive of both ends, in order.
 *
 * The calendar-day counterpart of `daysOfMonth`, for a metric that changes every day
 * rather than every parade: a soldier on a long MC is away on the weekend too, even
 * though no parade names them. Returns `[]` when either bound is missing or when `to`
 * precedes `from`, so a caller can map over it without a guard.
 * @param {?string} from Inclusive first day, ISO 'yyyy-MM-dd'.
 * @param {?string} to Inclusive last day, ISO 'yyyy-MM-dd'.
 * @returns {Array<string>} ISO 'yyyy-MM-dd' for each day in the range.
 */
export function eachDay(from, to) {
  if (!from || !to || to < from) {
    return [];
  }
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * The quick-range preset buttons, in the order they should appear.
 *
 * The UI reads this instead of hard-coding the list, so a preset added here shows up on
 * the button row for free, and `resolvePreset` recognises exactly these names.
 * @type {Array<{name: string, label: string}>}
 */
export const PRESETS = [
  { name: 'thisWeek', label: 'This week' },
  { name: 'lastWeek', label: 'Last week' },
  { name: 'thisMonth', label: 'This month' },
  { name: 'lastMonth', label: 'Last month' },
  { name: 'all', label: 'All' },
];

/**
 * Resolves a named quick-range preset to a concrete `{ from, to }` pair.
 *
 * `today` is passed in rather than read here so the caller controls the clock and the
 * result is testable. Weeks are Monday-first, matching `weekdayOf` in dates.js: a
 * battalion runs on the working week, not the calendar week. 'thisWeek' and 'thisMonth'
 * both stop at `today` rather than running to the end of the period — a range that
 * extended into the future would trail every trend line off to nothing.
 * @param {string} name One of the `PRESETS` names.
 * @param {string} today ISO 'yyyy-MM-dd' to measure back from.
 * @returns {{from: ?string, to: ?string}} The resolved range; open on both ends when the
 *     name is 'all' or unrecognised.
 */
export function resolvePreset(name, today) {
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
    case 'all':
      return { from: null, to: null };
    default:
      return { from: null, to: null };
  }
}

/**
 * The first day of a month, as ISO 'yyyy-MM-01'.
 * @param {string} isoDate Any ISO 'yyyy-MM-dd'.
 * @returns {string} ISO 'yyyy-MM-01'.
 */
export function firstOfMonth(isoDate) {
  return isoDate.slice(0, 7) + '-01';
}

/**
 * Shifts a first-of-month ISO date by a whole number of months.
 * @param {string} isoFirst ISO 'yyyy-MM-01'.
 * @param {number} delta Months to add; may be negative.
 * @returns {string} The resulting ISO 'yyyy-MM-01'.
 */
export function addMonths(isoFirst, delta) {
  const [year, month] = isoFirst.split('-').map(Number);
  const zeroBased = year * 12 + (month - 1) + delta;
  const shiftedYear = Math.floor(zeroBased / 12);
  const shiftedMonth = zeroBased - shiftedYear * 12;
  return shiftedYear + '-' + String(shiftedMonth + 1).padStart(2, '0') + '-01';
}

/**
 * The ISO dates of every day in a month, in order.
 * @param {string} isoFirst ISO 'yyyy-MM-01'.
 * @returns {Array<string>} ISO 'yyyy-MM-dd' for each day of that month.
 */
export function daysOfMonth(isoFirst) {
  const [year, month] = isoFirst.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let day = 1; day <= count; day += 1) {
    days.push(isoFirst.slice(0, 8) + String(day).padStart(2, '0'));
  }
  return days;
}

/**
 * Names the preset a `{ from, to }` pair corresponds to, measured from `today`.
 *
 * Lets the control light up the button a range came from, and show none once a
 * hand-picked span no longer matches any preset.
 * @param {?string} from Range lower bound, or null.
 * @param {?string} to Range upper bound, or null.
 * @param {string} today ISO 'yyyy-MM-dd' the presets are measured from.
 * @returns {?string} The preset name, or null when the pair matches none.
 */
export function matchPreset(from, to, today) {
  for (const preset of PRESETS) {
    const resolved = resolvePreset(preset.name, today);
    if (resolved.from === from && resolved.to === to) {
      return preset.name;
    }
  }
  return null;
}
