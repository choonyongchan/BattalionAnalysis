/**
 * Projected strength: who the battalion expects to have back over the coming days.
 *
 * Every other panel looks back; this one reads the dates the parade state already states.
 * An absentee line carries a start and an end date (`MC 22/09 - 24/09`), so a soldier on MC
 * today is expected back the day after the end date, and an absence dated to start later
 * (leave from Friday) is expected to take him away on that day.
 *
 * **Anchored on the reported figure.** The projection starts from the present strength the
 * parade state reports, then adds back each soldier whose absence has ended and removes each
 * whose absence has begun. It does not recompute present as strength minus the listed
 * absentees: the two disagree on real messages, and a projection that opened on a different
 * number from the tile above it would be read as a second, contradictory headcount.
 *
 * **Only MC and leave move it.** Those are the multi-day absences that take a soldier off
 * parade and state when he is back. MA is a timed appointment later the same day, and the
 * soldier is on parade that morning: on 22 Sep 26, 22 of 24 MA lines carried a time, and
 * counting MA and Others as away put 51 soldiers off parade against the 28 the strength
 * figures report, while MC and leave alone gave 23. Others is a mix of courses, exercises
 * and paperwork with no common meaning. Status is not absence and never enters it either.
 *
 * **No return date means not back.** An absence without an end date is held out for the
 * whole window and counted, so the reader sees how much of the projection rests on it.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS } from './classify.js';
import { addDays } from './dates.js';
import { COMPANIES } from './domain.js';
import { identityOf } from './identity.js';
import { battalionStrength } from './metrics.js';
import { toIsoDate, toText } from './values.js';

/** @type {number} Days projected past the parade date when the caller names none. */
export const DEFAULT_PROJECTION_DAYS = 7;

/**
 * The duty classes that keep a soldier off parade for dated days. See the module header.
 * @type {string[]}
 */
export const PROJECTED_CLASSES = [DUTY_CLASS.ATT_C, DUTY_CLASS.OFF_LEAVE];

/**
 * Whether an absence interval covers a date. A null end is open: the soldier is not back.
 * @param {{start: string, end: ?string}} interval The absence.
 * @param {string} isoDate The date.
 * @returns {boolean} True when the soldier is away that day.
 */
function covers_(interval, isoDate) {
  return interval.start <= isoDate && (interval.end === null || isoDate <= interval.end);
}

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
 * How many of one company's absent soldiers are away on a date.
 * @param {!Map<string, {intervals: Array<!Object>}>} soldiers A company's absentees.
 * @param {string} isoDate The date.
 * @returns {number} Soldiers away that day.
 */
function awayOn_(soldiers, isoDate) {
  let count = 0;
  soldiers.forEach((soldier) => {
    if (soldier.intervals.some((interval) => covers_(interval, isoDate))) {
      count += 1;
    }
  });
  return count;
}

/**
 * The parade date and the days after it.
 * @param {string} isoDate Parade date.
 * @param {number} days Days past it.
 * @returns {string[]} ISO dates, the parade date first.
 */
function windowFrom_(isoDate, days) {
  return Array.from({ length: days + 1 }, (_, offset) => addDays(isoDate, offset));
}

/**
 * One company's projected present strength across the window, clamped to its strength.
 * @param {{strength: ?number, present: ?number}} reported The company's reported figures.
 * @param {!Map<string, !Object>} soldiers The company's absentees.
 * @param {string[]} dates The window, parade date first.
 * @returns {Array<?number>} Projected present per date; null when nothing was reported.
 */
function projectCompany_(reported, soldiers, dates) {
  if (reported.strength === null || reported.present === null) {
    return dates.map(() => null);
  }
  const awayToday = awayOn_(soldiers, dates[0]);
  return dates.map((date) => {
    const present = reported.present + awayToday - awayOn_(soldiers, date);
    return Math.max(0, Math.min(reported.strength, present));
  });
}

/**
 * Projected % present over the days after one parade, battalion-wide or per company.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate The parade the projection starts from.
 * @param {{days?: number, session?: string, scope?: string}=} options `days` past the
 *     parade (default 7), `session` (default 'FPS'), and `scope`: 'battalion' (default)
 *     or 'companies'.
 * @returns {{dates: string[], series: Array<{name: string, values: Array<?number>}>,
 *     companiesReporting: string[], openEnded: number}} The series in % present, the
 *     companies it covers, and how many absentees stated no return date.
 */
export function projectedStrength(personnelRows, strengthRows, isoDate, options) {
  const days = options && Number.isInteger(options.days) ? options.days : DEFAULT_PROJECTION_DAYS;
  const session = (options && options.session) || 'FPS';
  const scope = (options && options.scope) || 'battalion';

  const dates = windowFrom_(isoDate, days);
  const strength = battalionStrength(strengthRows, isoDate, session);
  const absences = absencesOn_(personnelRows, isoDate, session);
  const projected = strength.byCompany.map((entry) => ({
    company: entry.company,
    strength: entry.strength,
    present: projectCompany_(entry, absences.get(entry.company) || new Map(), dates),
  }));

  const percent = (present, total) => (present === null || !total ? null : (present / total) * 100);
  const series =
    scope === 'companies'
      ? COMPANIES.map((company) => {
          const entry = projected.find((candidate) => candidate.company === company);
          return {
            name: company,
            values: dates.map((_, index) => (entry ? percent(entry.present[index], entry.strength) : null)),
          };
        })
      : [
          {
            name: 'Battalion',
            values: dates.map((_, index) => {
              const counted = projected.filter((entry) => entry.present[index] !== null);
              const present = counted.reduce((total, entry) => total + entry.present[index], 0);
              const total = counted.reduce((sum, entry) => sum + entry.strength, 0);
              return counted.length === 0 ? null : percent(present, total);
            }),
          },
        ];

  // Counted off the absences, not off `projected`: a company can list absentees without
  // filing a strength row, and this is the figure telling the reader how much of the
  // projection rests on an absence with no stated return. Counting only the companies
  // that filed would understate exactly the days being disclaimed.
  let openEnded = 0;
  absences.forEach((soldiers) => {
    soldiers.forEach((soldier) => {
      if (soldier.intervals.some((interval) => interval.end === null)) {
        openEnded += 1;
      }
    });
  });

  return { dates, series, companiesReporting: strength.companiesReporting, openEnded };
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
