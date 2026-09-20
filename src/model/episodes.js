/**
 * Collapses daily parade-state snapshots into episodes.
 *
 * A parade state is a snapshot, not an event: a soldier on four days of MC appears in
 * four submissions, twice a day if both FPS and LPS are filed. Counting those rows
 * answers "how many are absent today" and is the wrong grain for "how many times has he
 * been on MC" — which is the question S1 and the CO actually ask. This module produces
 * the second grain; `metrics.js` keeps using the first for daily rates.
 *
 * **Duration is reported, never derived.** `ParserRows` documents that the labelled
 * messages contain entries whose stated day-count contradicts their own date range, and
 * that computing the count would be wrong precisely where it fires. So an episode
 * carries the stated `num_days` and the start-to-end span side by side, records which
 * one it used, and raises `disagreement` when they differ — turning a contradiction
 * into a data-quality signal rather than silently picking a winner.
 *
 * Every function here is pure.
 */

import { classify, extractSymptoms } from './classify.js';
import { PERM_STATUS_NUM_DAYS } from './domain.js';
import { identityOf } from './identity.js';
import { inclusiveDaySpan, isoToUtcMs } from './dates.js';
import { toIsoDate, toNumber, toText } from './values.js';

/**
 * Groups rows that share a non-blank `start_date`, and runs of consecutive parade dates
 * for rows that state none.
 *
 * The two rules exist because the data supports two different certainties. A stated
 * start date defines the episode outright. Without one, all that is known is that the
 * soldier appeared on these parade dates, so a gap of more than a day is taken as the
 * boundary between two episodes.
 * @param {Array<!Object>} rows One soldier's rows within one duty class, date-sorted.
 * @returns {Array<Array<!Object>>} Rows grouped into episodes.
 */
function groupIntoEpisodes_(rows) {
  const dated = new Map();
  const undated = [];
  rows.forEach((row) => {
    const start = toIsoDate(row.start_date);
    if (start) {
      const bucket = dated.get(start) || [];
      bucket.push(row);
      dated.set(start, bucket);
    } else {
      undated.push(row);
    }
  });

  const groups = Array.from(dated.values());
  let run = [];
  let previousDate = null;
  undated.forEach((row) => {
    const date = toIsoDate(row.date);
    const isNewRun =
      run.length > 0 && (!date || !previousDate || inclusiveDaySpan(previousDate, date) > 2);
    if (isNewRun) {
      groups.push(run);
      run = [];
    }
    run.push(row);
    previousDate = date || previousDate;
  });
  if (run.length > 0) {
    groups.push(run);
  }
  return groups;
}

/**
 * Picks the last non-blank value of a field across a group's rows.
 *
 * Last rather than first because a soldier's platoon may be filled in on a later
 * submission after being left blank on an earlier one, and the later record is the
 * better-informed one.
 * @param {Array<!Object>} rows The episode's rows, date-sorted.
 * @param {string} field Field name to read.
 * @returns {string} The value, or ''.
 */
function latestValue_(rows, field) {
  let value = '';
  rows.forEach((row) => {
    const candidate = toText(row[field]);
    if (candidate !== '') {
      value = candidate;
    }
  });
  return value;
}

/**
 * Builds one episode from a group of rows.
 * @param {string} key Identity key.
 * @param {string} dutyClass One of DUTY_CLASS's values.
 * @param {Array<!Object>} rows The group's rows, date-sorted.
 * @returns {!Object} The episode.
 */
function buildEpisode_(key, dutyClass, rows) {
  const paradeDates = Array.from(
    new Set(rows.map((row) => toIsoDate(row.date)).filter((date) => date !== null))
  ).sort();
  const startDate = toIsoDate(rows[0].start_date) || paradeDates[0] || null;
  const endDate = toIsoDate(latestValue_(rows, 'end_date')) || paradeDates[paradeDates.length - 1] || null;

  const rawStatedDays = toNumber(latestValue_(rows, 'num_days'));
  const permanent = rawStatedDays === PERM_STATUS_NUM_DAYS;
  const statedDays = permanent ? null : rawStatedDays;
  const hasStatedDates = Boolean(toIsoDate(rows[0].start_date) && toIsoDate(latestValue_(rows, 'end_date')));
  const spanDays = hasStatedDates ? inclusiveDaySpan(startDate, endDate) : null;
  const observedDays = paradeDates.length;

  const duration = chooseDuration_(statedDays, spanDays, observedDays);
  const reasons = Array.from(new Set(rows.map((row) => toText(row.reason)).filter((text) => text !== '')));
  const symptoms = Array.from(new Set(reasons.flatMap((reason) => extractSymptoms(reason))));

  return {
    key,
    dutyClass,
    fourD: latestValue_(rows, 'four_d'),
    name: latestValue_(rows, 'name'),
    rank: latestValue_(rows, 'rank'),
    company: latestValue_(rows, 'company'),
    platoon: latestValue_(rows, 'platoon'),
    startDate,
    endDate,
    paradeDates,
    observedDays,
    statedDays,
    spanDays,
    permanent,
    daysLost: duration.days,
    daysLostSource: duration.source,
    disagreement: statedDays !== null && spanDays !== null && statedDays !== spanDays,
    reasons,
    symptoms,
    rowCount: rows.length,
  };
}

/**
 * Chooses the day count to report, preferring what the message stated.
 *
 * The order is deliberate: what the message said, then what its own dates imply, then
 * what was actually observed on parade. Each step down is a weaker claim, so the source
 * travels with the number and the dashboard shows the mix rather than implying every
 * figure is equally well attested.
 * @param {?number} statedDays `num_days` as stated, or null.
 * @param {?number} spanDays Inclusive start-to-end span, or null.
 * @param {number} observedDays Distinct parade dates the soldier appeared on.
 * @returns {{days: number, source: string}} The day count and where it came from.
 */
function chooseDuration_(statedDays, spanDays, observedDays) {
  if (statedDays !== null && statedDays > 0) {
    return { days: statedDays, source: 'stated' };
  }
  if (spanDays !== null && spanDays > 0) {
    return { days: spanDays, source: 'span' };
  }
  return { days: observedDays, source: 'observed' };
}

/**
 * Collapses personnel rows into episodes, one per soldier per continuous absence.
 * @param {Array<!Object>} rows Normalised Personnel Data records.
 * @returns {Array<!Object>} Episodes, sorted by start date then soldier name.
 */
export function buildEpisodes(rows) {
  const byPersonAndClass = new Map();
  rows.forEach((row) => {
    const identity = identityOf(row);
    if (identity.key === '') {
      return;
    }
    const dutyClass = classify(row);
    const groupKey = identity.key + '|' + dutyClass;
    const bucket = byPersonAndClass.get(groupKey) || { key: identity.key, dutyClass, rows: [] };
    bucket.rows.push(row);
    byPersonAndClass.set(groupKey, bucket);
  });

  const episodes = [];
  byPersonAndClass.forEach((bucket) => {
    const sorted = bucket.rows.slice().sort(byParadeDate_);
    groupIntoEpisodes_(sorted).forEach((group) => {
      episodes.push(buildEpisode_(bucket.key, bucket.dutyClass, group.slice().sort(byParadeDate_)));
    });
  });

  return episodes.sort((a, b) => {
    const byDate = String(a.startDate).localeCompare(String(b.startDate));
    return byDate !== 0 ? byDate : String(a.name).localeCompare(String(b.name));
  });
}

/**
 * Comparator ordering personnel rows by parade date, then session.
 * @param {!Object} a First row.
 * @param {!Object} b Second row.
 * @returns {number} Standard comparator result.
 */
function byParadeDate_(a, b) {
  const dateA = toIsoDate(a.date);
  const dateB = toIsoDate(b.date);
  if (dateA && dateB && dateA !== dateB) {
    return isoToUtcMs(dateA) - isoToUtcMs(dateB);
  }
  return toText(a.session).localeCompare(toText(b.session));
}
