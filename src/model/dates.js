/**
 * ISO date arithmetic, done in UTC so a calendar date never shifts with the viewer.
 *
 * Every date in this dashboard is a Singapore calendar date that the feed has already
 * rendered as text. Treating those strings as UTC midnights keeps "22 July" reading as
 * the 22nd in Singapore and in London alike; using local time would not.
 *
 * Every function here is pure.
 */

/** @type {number} Milliseconds in one day. */
export const MS_PER_DAY = 86400000;

/**
 * Epoch Sheets serial numbers count from: 1899-12-30 UTC, where serial 1 is 1899-12-31.
 * @type {number}
 */
export const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);

/** @type {string[]} Short weekday names, Monday first. */
const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** @type {string[]} Short month names, January first. */
export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Renders a UTC millisecond timestamp as an ISO 'yyyy-MM-dd' date string.
 * @param {number} ms Milliseconds since the Unix epoch, UTC.
 * @returns {string} ISO 'yyyy-MM-dd'.
 */
export function isoFromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Converts an ISO date string to UTC milliseconds.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {number} Milliseconds at UTC midnight of that date.
 */
export function isoToUtcMs(isoDate) {
  const parts = isoDate.split('-').map(Number);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

/**
 * Adds a whole number of days to an ISO date string.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @param {number} days Days to add; may be negative.
 * @returns {string} The resulting ISO 'yyyy-MM-dd'.
 */
export function addDays(isoDate, days) {
  return isoFromUtcMs(isoToUtcMs(isoDate) + days * MS_PER_DAY);
}

/**
 * Counts days from one ISO date to another, inclusive of both ends.
 *
 * Inclusive because a one-day MC has `start_date` equal to `end_date` and must count as
 * one day, not zero.
 * @param {string} startIso ISO 'yyyy-MM-dd'.
 * @param {string} endIso ISO 'yyyy-MM-dd'.
 * @returns {number} The inclusive span; negative when end precedes start.
 */
export function inclusiveDaySpan(startIso, endIso) {
  const days = (isoToUtcMs(endIso) - isoToUtcMs(startIso)) / MS_PER_DAY;
  return days >= 0 ? days + 1 : days;
}

/**
 * Returns the weekday for an ISO date.
 *
 * Monday-first because the bridge-day question is about Mondays and Fridays sitting at
 * the ends of the working week, which a Sunday-first index splits apart.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {{index: number, name: string}} Day index with Monday as 0, and its short name.
 */
export function weekdayOf(isoDate) {
  const sundayFirst = new Date(isoToUtcMs(isoDate)).getUTCDay();
  const index = (sundayFirst + 6) % 7;
  return { index, name: WEEKDAY_NAMES[index] };
}

/**
 * Whether an ISO date falls on a Saturday or Sunday.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {boolean} True for Saturday and Sunday.
 */
export function isWeekend(isoDate) {
  return weekdayOf(isoDate).index >= 5;
}
