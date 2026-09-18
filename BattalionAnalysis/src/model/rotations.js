/**
 * The battalion's training rotation schedule: TRADES and Rot 1 through Rot 4.
 *
 * This concept exists nowhere else in the repo or the data — it is defined here,
 * against an optional "Rotations" tab. A battalion that has not set the tab up still
 * gets a working dashboard with rotational grouping simply unavailable, so nothing here
 * may throw on an empty or missing feed. `rotationIssues` exists because the tab is
 * hand-maintained: a commander editing it can swap a rotation's dates, leave two
 * rotations overlapping, or leave days assigned to nothing, and the Settings page needs
 * to say so in a sentence a person can act on.
 *
 * Not using date-fns here: containment, overlap and gap checks are all comparisons
 * between ISO 'yyyy-MM-dd' strings, which compare correctly as plain strings. Pulling in
 * a date library to compare strings would add a dependency for nothing.
 *
 * Every function here is pure.
 */

import { addDays } from './dates.js';
import { toIsoDate, toText } from './values.js';

/**
 * Whether a rotation contains an ISO date.
 *
 * A `null` end means open-ended: the rotation contains every date from its start
 * onward.
 * @param {{start: string, end: ?string}} rotation A rotation.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @returns {boolean} Whether the date falls within the rotation.
 */
function contains_(rotation, isoDate) {
  if (isoDate < rotation.start) {
    return false;
  }
  return rotation.end === null || isoDate <= rotation.end;
}

/**
 * Whether two rotations' date spans overlap at all.
 *
 * A `null` end is treated as unbounded going forward, matching what "open-ended" means
 * for `contains_`.
 * @param {{start: string, end: ?string}} a One rotation.
 * @param {{start: string, end: ?string}} b Another rotation.
 * @returns {boolean} Whether their spans share a day.
 */
function overlaps_(a, b) {
  if (a.end !== null && a.end < b.start) {
    return false;
  }
  if (b.end !== null && b.end < a.start) {
    return false;
  }
  return true;
}

/**
 * Parses raw "Rotations" rows into sorted start/end triples.
 *
 * A row missing a name, or whose start date cannot be parsed, is dropped — a rotation
 * needs both to mean anything. A missing end date is not an error: it leaves the
 * rotation open-ended rather than assigning it a false boundary.
 * @param {Array<!Object>} rows Raw records with `name`, `start_date` and `end_date`
 *     cells; may be `[]` or missing when the tab does not exist.
 * @returns {Array<{name: string, start: string, end: ?string}>} Rotations sorted by
 *     start date.
 */
export function toRotations(rows) {
  return (rows || [])
    .map((row) => {
      const name = toText(row.name);
      const start = toIsoDate(row.start_date);
      if (name === '' || !start) {
        return null;
      }
      return { name, start, end: toIsoDate(row.end_date) };
    })
    .filter((rotation) => rotation !== null)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * Names the rotation containing an ISO date.
 *
 * When two rotations overlap on that date, the earliest-starting one wins — chosen
 * regardless of `rotations`' own order, so the answer does not depend on how the tab
 * happened to be sorted when it was read.
 * @param {string} isoDate ISO 'yyyy-MM-dd'.
 * @param {Array<{name: string, start: string, end: ?string}>} rotations Rotations, as
 *     from `toRotations`.
 * @returns {?string} The rotation's name, or null when no rotation contains the date.
 */
export function rotationOf(isoDate, rotations) {
  const matches = (rotations || []).filter((rotation) => contains_(rotation, isoDate));
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return matches[0].name;
}

/**
 * Finds data-quality problems in a rotation schedule, for the Settings page.
 *
 * Each message names the rotation(s) involved and what is wrong, for a commander to
 * read and act on directly rather than a stack trace. An empty schedule produces no
 * issues — a battalion that has not set the tab up yet is not "broken".
 * @param {Array<{name: string, start: string, end: ?string}>} rotations Rotations, as
 *     from `toRotations`.
 * @returns {Array<{kind: string, message: string}>} Issues found, kind one of
 *     'overlap', 'gap', 'invalid'.
 */
export function rotationIssues(rotations) {
  const list = rotations || [];
  const issues = [];

  list.forEach((rotation) => {
    if (rotation.end !== null && rotation.end < rotation.start) {
      issues.push({
        kind: 'invalid',
        message:
          rotation.name + ' ends (' + rotation.end + ') before it starts (' + rotation.start +
          '); fix its start or end date.',
      });
    }
  });

  const sorted = list
    .filter((rotation) => rotation.end === null || rotation.end >= rotation.start)
    .slice()
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (overlaps_(sorted[i], sorted[j])) {
        issues.push({
          kind: 'overlap',
          message:
            sorted[i].name + ' and ' + sorted[j].name +
            ' overlap; adjust their start or end dates so only one rotation covers each day.',
        });
      }
    }
  }

  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current.end === null || overlaps_(current, next)) {
      continue;
    }
    const gapStart = addDays(current.end, 1);
    if (gapStart < next.start) {
      const gapEnd = addDays(next.start, -1);
      issues.push({
        kind: 'gap',
        message:
          gapStart + ' to ' + gapEnd + ' belongs to no rotation, between ' + current.name +
          ' and ' + next.name + '; add a rotation covering those days.',
      });
    }
  }

  return issues;
}

/**
 * The outer bounds of a rotation schedule.
 * @param {Array<{name: string, start: string, end: ?string}>} rotations Rotations, as
 *     from `toRotations`.
 * @returns {?{start: string, end: ?string}} The earliest start and latest end, `end`
 *     null when any rotation is open-ended, or null for an empty schedule.
 */
export function rotationSpan(rotations) {
  const list = rotations || [];
  if (list.length === 0) {
    return null;
  }
  const start = list.reduce((earliest, rotation) => (rotation.start < earliest ? rotation.start : earliest), list[0].start);
  const openEnded = list.some((rotation) => rotation.end === null);
  const end = openEnded
    ? null
    : list.reduce((latest, rotation) => (rotation.end > latest ? rotation.end : latest), list[0].end);
  return { start, end };
}
