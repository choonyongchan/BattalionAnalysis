/**
 * Coerces raw spreadsheet cells into the three types the dashboard reasons about.
 *
 * A cell holding `2026-06-22` may arrive as that string, where the parser wrote text, or
 * as a value Sheets coerced the write into. What must never reach here is a
 * locale-formatted string like `22/06/2026`, which means June in Singapore and is
 * unparseable elsewhere, or a UTC rendering of a local midnight, which slides the date
 * back a day. `DashboardFeed.toJsonValue_` closes both off on the Apps Script side;
 * `toIsoDate` reads the result, and still accepts a Sheets serial so the function stays
 * correct for any caller that has one.
 *
 * Every function here is pure.
 */

import { MS_PER_DAY, SHEETS_EPOCH_MS, isoFromUtcMs } from './dates.js';

/**
 * Coerces a cell to a number, or null when it holds no usable one.
 *
 * Null rather than 0: a blank strength cell means "not stated", and summing it as zero
 * would understate the battalion without saying so.
 * @param {*} value Cell value.
 * @returns {?number} The number, or null.
 */
export function toNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = String(value == null ? '' : value).trim();
  if (text === '') {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Coerces a cell to an ISO 'yyyy-MM-dd' date string, or null when it holds none.
 *
 * A serial is read in UTC so the calendar date never shifts with the viewer's timezone.
 * @param {*} value Cell value.
 * @returns {?string} ISO 'yyyy-MM-dd', or null.
 */
export function toIsoDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return isoFromUtcMs(SHEETS_EPOCH_MS + Math.floor(value) * MS_PER_DAY);
  }
  const text = String(value == null ? '' : value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? match[1] + '-' + match[2] + '-' + match[3] : null;
}

/**
 * Reads the time of day out of a cell that carries one.
 *
 * The feed renders a cell with a time as `yyyy-MM-dd'T'HH:mm:ss` and one without as
 * `yyyy-MM-dd`, so the absence of a time is a fact about the cell, not a parse failure.
 * A Sheets serial's fractional part is the time.
 * @param {*} value Cell value.
 * @returns {?{hour: number, minute: number, minutes: number}} Time of day, or null.
 */
export function toTimeOfDay(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = value - Math.floor(value);
    const minutes = Math.round(fraction * 1440) % 1440;
    return { hour: Math.floor(minutes / 60), minute: minutes % 60, minutes };
  }
  const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(String(value == null ? '' : value).trim());
  if (!match) {
    return null;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

/**
 * Trims a cell to a string, mapping blank-ish values to ''.
 * @param {*} value Cell value.
 * @returns {string} Trimmed text, or ''.
 */
export function toText(value) {
  return String(value == null ? '' : value).trim();
}
