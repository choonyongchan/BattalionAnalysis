/** ISO date arithmetic in UTC, so a Singapore calendar date never shifts with the viewer's timezone. */

/** Milliseconds in one day. */
export const MS_PER_DAY = 86400000;

/** Singapore is UTC+8 all year, with no daylight saving. */
export const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Short weekday names, Monday first. */
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Short month names, January first. */
export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An ISO timestamp as a Singapore date and `HH:mm`, or null when unreadable. */
export function receivedInSgt(timestamp: string | null | undefined): { date: string; time: string } | null {
  const iso = sgtDateTime(timestamp);
  return iso ? { date: iso.slice(0, 10), time: iso.slice(11, 16) } : null;
}

/** An instant (ISO, or the driver's `2026-09-18 00:15:23.5+00`) as Singapore-local `yyyy-MM-ddTHH:mm:ss`, or ''. */
export function sgtDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const ms = Date.parse(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  return Number.isNaN(ms) ? '' : new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 19);
}

/** UTC milliseconds as `yyyy-MM-dd`. */
export function isoFromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `yyyy-MM-dd` as UTC milliseconds at midnight. */
export function isoToUtcMs(isoDate: string): number {
  const [year = 0, month = 1, day = 1] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** Adds whole days (may be negative) to a `yyyy-MM-dd` date. */
export function addDays(isoDate: string, days: number): string {
  return isoFromUtcMs(isoToUtcMs(isoDate) + days * MS_PER_DAY);
}

/** Days from start to end counting both ends (a one-day MC is 1); negative when end precedes start. */
export function inclusiveDaySpan(startIso: string, endIso: string): number {
  const days = (isoToUtcMs(endIso) - isoToUtcMs(startIso)) / MS_PER_DAY;
  return days >= 0 ? days + 1 : days;
}

/** Weekday of a date, Monday = 0, so Mondays and Fridays sit at the ends of the week. */
export function weekdayOf(isoDate: string): { index: number; name: string } {
  const index = (new Date(isoToUtcMs(isoDate)).getUTCDay() + 6) % 7;
  return { index, name: WEEKDAY_NAMES[index]! };
}

/** Whether a date is a Saturday or Sunday. */
export function isWeekend(isoDate: string): boolean {
  return weekdayOf(isoDate).index >= 5;
}
