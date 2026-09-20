/**
 * Every number, date and time the dashboard puts on screen goes through here.
 *
 * One module, because a figure has to read the same on a chart axis, in that chart's
 * tooltip, and in the table twin a reader copies into a brief. There were two copies of
 * this before — one under `charts/`, one under `components/` — and they had drifted into
 * two functions named `fmtShare` that took different arguments and returned different
 * precision, which is exactly the defect a single copy prevents.
 *
 * A missing value formats as an em dash everywhere, never as 0 and never as a blank
 * cell: a blank strength cell means "not stated", and printing 0 would say the opposite.
 *
 * Locale is 'en-SG' throughout — this is a Singapore Armed Forces battalion, and a figure
 * should not render in whatever locale the reading machine happens to carry.
 */

import { MONTH_NAMES } from './model/dates.js';

/** @type {!Intl.NumberFormat} Whole numbers with thousands separators. */
const COUNT = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 });

/** @type {!Intl.NumberFormat} One decimal place, for a rate. */
const RATE = new Intl.NumberFormat('en-SG', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Formats a whole number, or an em dash when there is none.
 * @param {?number} value The number.
 * @returns {string} The formatted count, or '—'.
 */
export function fmtInt(value) {
  return Number.isFinite(value) ? COUNT.format(Math.round(value)) : '—';
}

/**
 * Formats a number to one decimal place, with an optional suffix.
 * @param {?number} value The number.
 * @param {string=} suffix Text appended when a value is present, e.g. '%'.
 * @returns {string} The formatted value, or '—'.
 */
export function fmtDecimal(value, suffix) {
  return Number.isFinite(value) ? RATE.format(value) + (suffix || '') : '—';
}

/**
 * Formats a proportion in the range 0..1 as a whole percentage.
 *
 * Whole numbers because this is the tile figure a commander reads at a glance; the
 * decimal belongs on a chart, where values are being compared against each other.
 * @param {?number} value The proportion, 0..1.
 * @returns {string} e.g. '18%', or '—'.
 */
export function fmtPercent(value) {
  return Number.isFinite(value) ? Math.round(value * 100) + '%' : '—';
}

/**
 * Formats a part of a total as a percentage, to one decimal place.
 *
 * Distinct from `fmtPercent` in both argument shape and precision, and named so the two
 * cannot be confused at a call site.
 * @param {number} part The part.
 * @param {number} total The whole.
 * @returns {string} e.g. '18.4%', or '—' when the total is zero or missing.
 */
export function fmtShareOf(part, total) {
  return Number.isFinite(part) && Number.isFinite(total) && total > 0
    ? fmtDecimal((part / total) * 100, '%')
    : '—';
}

/**
 * Formats an ISO date the way the unit writes it, e.g. '22 Jun 26'.
 * @param {?string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {string} The formatted date, or '—'.
 */
export function fmtDate(isoDate) {
  if (!isoDate) {
    return '—';
  }
  const [year, month, day] = isoDate.split('-');
  return Number(day) + ' ' + MONTH_NAMES[Number(month) - 1] + ' ' + year.slice(2);
}

/**
 * Formats a fraction as "n of m", the shape every coverage line in the dashboard uses.
 * @param {number} part The numerator.
 * @param {number} whole The denominator.
 * @returns {string} e.g. '5 of 45'.
 */
export function fmtFraction(part, whole) {
  return fmtInt(part) + ' of ' + fmtInt(whole);
}

/**
 * Formats minutes past midnight as a 24-hour clock time.
 *
 * Zero-padded on both halves because the reader is comparing six of these down a column,
 * and '7:05' next to '11:40' does not line up.
 * @param {?number} minutes Minutes past midnight.
 * @returns {string} 'HH:mm', or '—'.
 */
export function fmtClock(minutes) {
  if (!Number.isFinite(minutes)) {
    return '—';
  }
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
}
