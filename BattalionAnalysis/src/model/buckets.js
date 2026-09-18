/**
 * Groups dates into the four grains the report-sick chart offers.
 *
 * Every key here must sort chronologically as a plain string, because every chart in the
 * dashboard orders its x-axis that way. Daily, weekly and monthly get that for free from
 * ISO dates. Rotational does not — "Rot 1" sorts before "TRADES" alphabetically and after
 * it in time — so a rotation is keyed on its start date and carries its name in the label
 * instead. A date belonging to no rotation is keyed to sort last rather than dropped: a
 * chart that silently omits four days in August is worse than one with a bucket saying
 * those four days were never assigned.
 *
 * Every function here is pure.
 */

import { addDays, MONTH_NAMES, weekdayOf } from './dates.js';
import { rotationOf } from './rotations.js';

/**
 * The key a date with no rotation falls under.
 *
 * A date far past any real rotation, so it sorts after every rotation key without needing
 * the sort to know about it.
 * @type {string}
 */
const NO_ROTATION_KEY = '9999-12-31';

/** @type {string} What that bucket is called on the axis. */
const NO_ROTATION_LABEL = 'No rotation';

/**
 * The grouping options, in the order the radio shows them.
 * @type {Array<{name: string, label: string}>}
 */
export const GRANULARITIES = [
  { name: 'daily', label: 'Daily' },
  { name: 'weekly', label: 'Weekly' },
  { name: 'monthly', label: 'Monthly' },
  { name: 'rotational', label: 'Rotational' },
];

/**
 * Formats an ISO date as 'Mon 20 Jul'.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {string} The day label.
 */
function dayLabel_(isoDate) {
  const month = MONTH_NAMES[Number(isoDate.slice(5, 7)) - 1];
  return weekdayOf(isoDate).name + ' ' + Number(isoDate.slice(8, 10)) + ' ' + month;
}

/**
 * The Monday of the week an ISO date falls in.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {string} ISO 'yyyy-MM-dd' of that Monday.
 */
function mondayOf_(isoDate) {
  return addDays(isoDate, -weekdayOf(isoDate).index);
}

/**
 * The bucket an ISO date belongs to at a given grain.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @param {string} granularity One of GRANULARITIES' names.
 * @param {Array<{name: string, start: string, end: ?string}>} rotations Rotations, for
 *     the rotational grain; ignored otherwise and safe to pass as [].
 * @returns {{key: string, label: string}} The bucket's sort key and axis label.
 */
export function bucketOf(isoDate, granularity, rotations) {
  if (granularity === 'weekly') {
    const monday = mondayOf_(isoDate);
    const month = MONTH_NAMES[Number(monday.slice(5, 7)) - 1];
    return { key: monday, label: 'Week of ' + Number(monday.slice(8, 10)) + ' ' + month };
  }

  if (granularity === 'monthly') {
    const key = isoDate.slice(0, 7);
    return { key, label: MONTH_NAMES[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(0, 4) };
  }

  if (granularity === 'rotational') {
    const name = rotationOf(isoDate, rotations);
    if (name === null) {
      return { key: NO_ROTATION_KEY, label: NO_ROTATION_LABEL };
    }
    const rotation = (rotations || []).find((entry) => entry.name === name);
    return { key: rotation.start, label: rotation.name };
  }

  return { key: isoDate, label: dayLabel_(isoDate) };
}

/**
 * Groups dates into buckets, in chronological order.
 *
 * The dates inside each bucket are sorted too, so a caller can read the first and last
 * without re-sorting, whatever order they arrived in.
 * @param {string[]} dates ISO 'yyyy-MM-dd' dates, in any order.
 * @param {string} granularity One of GRANULARITIES' names.
 * @param {Array<{name: string, start: string, end: ?string}>} rotations Rotations, for
 *     the rotational grain.
 * @returns {Array<{key: string, label: string, dates: string[]}>} Buckets, earliest first.
 */
export function groupDates(dates, granularity, rotations) {
  const buckets = new Map();
  (dates || []).forEach((date) => {
    const bucket = bucketOf(date, granularity, rotations);
    const existing = buckets.get(bucket.key);
    if (existing) {
      existing.dates.push(date);
      return;
    }
    buckets.set(bucket.key, { key: bucket.key, label: bucket.label, dates: [date] });
  });

  return Array.from(buckets.values())
    .map((bucket) => ({ ...bucket, dates: bucket.dates.slice().sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
