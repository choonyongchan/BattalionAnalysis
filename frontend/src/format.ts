/**
 * Every number, date and time on screen goes through here, so a figure reads the same on an axis, in a
 * tooltip and in a table. A missing value is an em dash, never 0 (a blank strength is "not stated").
 */

import { MONTH_NAMES } from '../../shared/dates.ts';

const COUNT = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 });
const RATE = new Intl.NumberFormat('en-SG', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Whether a value is a finite number. */
const isNumber = (value: number | null | undefined): value is number => Number.isFinite(value);

/** A whole number with thousands separators, or '—'. */
export function fmtInt(value: number | null | undefined): string {
  return isNumber(value) ? COUNT.format(Math.round(value)) : '—';
}

/** A number to one decimal place with an optional suffix such as '%', or '—'. */
export function fmtDecimal(value: number | null | undefined, suffix = ''): string {
  return isNumber(value) ? RATE.format(value) + suffix : '—';
}

/** A 0..1 proportion as a whole percentage (the at-a-glance tile figure), or '—'. */
export function fmtPercent(value: number | null | undefined): string {
  return isNumber(value) ? Math.round(value * 100) + '%' : '—';
}

/** `yyyy-MM-dd` the way the unit writes it, e.g. '22 Jun 26', or '—'. */
export function fmtDate(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const [year = '', month, day] = isoDate.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year.slice(2)}`;
}

/** `yyyy-MM-dd` as day and month, e.g. '22 Jun', for an axis; anything else comes back as is. */
export function fmtDayMonth(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return isoDate;
  const [, month, day] = isoDate.split('-');
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]}`;
}

/** A fraction as "n of m", the shape every coverage line uses. */
export function fmtFraction(part: number, whole: number): string {
  return `${fmtInt(part)} of ${fmtInt(whole)}`;
}

/** Minutes past midnight as a zero-padded 24-hour 'HH:mm' (so a column lines up), or '—'. */
export function fmtClock(minutes: number | null | undefined): string {
  if (!isNumber(minutes)) return '—';
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}
