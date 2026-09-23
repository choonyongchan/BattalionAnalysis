/**
 * Returns to duty: who the battalion expects to have back over the coming days.
 *
 * Every other panel looks back; this one reads the dates the parade state already states.
 * An absentee line carries a start and an end date (`MC 22/09 - 24/09`), so a soldier on MC
 * today is expected back the day after the end date, and an absence dated to start later
 * (leave from Friday) is expected to take him away on that day.
 *
 * **Only MC and leave count.** Those are the multi-day absences that take a soldier off
 * parade and state when he is back. MA is a timed appointment later the same day, and the
 * soldier is on parade that morning: on 22 Sep 26, 22 of 24 MA lines carried a time, and
 * counting MA and Others as away put 51 soldiers off parade against the 28 the strength
 * figures report, while MC and leave alone gave 23. Others is a mix of courses, exercises
 * and paperwork with no common meaning. Status is not absence and never enters it either.
 *
 * **No return date means not back.** An absence without an end date is listed with no day
 * back rather than a guessed one.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS } from './classify.js';
import { addDays } from './dates.js';
import { identityOf } from './identity.js';
import { toIsoDate, toText } from './values.js';

/** @type {number} Days ahead the forward-looking section names when the caller names none. */
export const DEFAULT_PROJECTION_DAYS = 7;

/**
 * The duty classes that keep a soldier off parade for dated days. See the module header.
 * @type {string[]}
 */
export const PROJECTED_CLASSES = [DUTY_CLASS.ATT_C, DUTY_CLASS.OFF_LEAVE];

/**
 * Each soldier on MC or leave on one parade, per company, with every interval stated for him.
 *
 * A soldier listed twice (an MC and a leave that follows it) is one soldier with two
 * intervals, so he is counted once on any day and is back only when both have ended.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {!Map<string, !Map<string, {row: !Object, intervals: Array<!Object>}>>}
 *     Company to identity key to the soldier's first row and his intervals.
 */
function absencesOn_(personnelRows, isoDate, session) {
  const byCompany = new Map();
  personnelRows
    .filter(
      (row) =>
        toIsoDate(row.date) === isoDate &&
        toText(row.session) === session &&
        PROJECTED_CLASSES.includes(classify(row))
    )
    .forEach((row) => {
      const key = identityOf(row).key;
      if (key === '') {
        return;
      }
      const company = toText(row.company);
      const soldiers = byCompany.get(company) || new Map();
      const soldier = soldiers.get(key) || { row, intervals: [] };
      soldier.intervals.push({
        start: toIsoDate(row.start_date) || isoDate,
        end: toIsoDate(row.end_date),
      });
      soldiers.set(key, soldier);
      byCompany.set(company, soldiers);
    });
  return byCompany;
}

/**
 * The soldiers on MC or leave on one parade, with the day each is expected back.
 *
 * Expected back is the day after the latest stated end date across his absences, and null
 * when any of them states none; `from` is the earliest stated start, which is after the
 * parade date for an absence booked ahead. Sorted by the day back, soonest first,
 * open-ended last.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string=} session Parade session; defaults to 'FPS'.
 * @returns {Array<{key: string, rank: string, name: string, company: string,
 *     platoon: string, category: string, reason: string, from: string, backOn: ?string}>}
 *     One row per absent soldier.
 */
export function returnsToDuty(personnelRows, isoDate, session) {
  const rows = [];
  absencesOn_(personnelRows, isoDate, session || 'FPS').forEach((soldiers, company) => {
    soldiers.forEach((soldier, key) => {
      const ends = soldier.intervals.map((interval) => interval.end);
      const backOn = ends.includes(null) ? null : addDays(ends.sort().pop(), 1);
      rows.push({
        key,
        rank: toText(soldier.row.rank),
        name: toText(soldier.row.name),
        company,
        platoon: toText(soldier.row.platoon),
        category: toText(soldier.row.reason_category),
        reason: toText(soldier.row.reason),
        from: soldier.intervals.map((interval) => interval.start).sort()[0],
        backOn,
      });
    });
  });
  return rows.sort(
    (a, b) =>
      (a.backOn === null) - (b.backOn === null) ||
      String(a.backOn).localeCompare(String(b.backOn)) ||
      a.name.localeCompare(b.name)
  );
}
