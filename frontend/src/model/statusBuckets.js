/**
 * Folds Personnel Data's free-text `Status` reasons into ten fixed buckets.
 *
 * 403 distinct strings carry the same handful of restrictions in wildly different
 * spellings — "Excuse RMJ" / "EX RMJ" / "RMJ" are one vocabulary written three ways — and
 * one reason commonly names several restrictions at once, so matching is multi-label: a
 * reason can and often does land in more than one bucket. A reason is only ever routed to
 * 'Other' when none of the nine named restrictions match it; a reason that matches a named
 * bucket is not also tagged 'Other' for the unrecognised words alongside it.
 *
 * Permanence has its own inconsistency. `PERM_STATUS_NUM_DAYS` (999, from domain.js) is
 * the intended sentinel, but no row in the real data carries it — every Status row whose
 * `reason` matches /perm/i has a blank `num_days` instead. `isPermanentStatus` checks the
 * sentinel first, in case it starts being written, and falls back to the reason text,
 * which is what actually carries the signal today.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS } from './classify.js';
import { COMPANIES, PERM_STATUS_NUM_DAYS } from '../../../shared/domain.js';
import { identityOf } from '../../../shared/identity.js';
import { toIsoDate, toNumber, toText } from '../../../shared/values.js';

/**
 * The ten Status buckets, in report order.
 * @type {string[]}
 */
export const STATUS_BUCKETS = [
  'Light Duty',
  'Excuse RMJ',
  'Excuse Heavy Load',
  'Excuse Upper Limb',
  'Excuse Uniform',
  'Excuse FLEGS/GELS',
  'Excuse Grenade/Pyro',
  'Excuse Kneeling/Squatting',
  'Excuse Stay-In',
  'Other',
];

/**
 * The patterns that route free text into each named bucket, checked in STATUS_BUCKETS
 * order. 'Other' has no pattern of its own — see `bucketsFor`.
 * @type {!Object<string, !RegExp>}
 */
const BUCKET_PATTERNS = {
  'Light Duty': /\bLD\b|light\s*duty/i,
  'Excuse RMJ': /\bRMJ\b/i,
  'Excuse Heavy Load': /heavy\s*loads?/i,
  'Excuse Upper Limb': /upper\s*limbs?|\bUL\b/i,
  'Excuse Uniform': /\bCU\b|uniform/i,
  'Excuse FLEGS/GELS': /\bFLEGS\b|\bGELS\b|\bflags?\b/i,
  'Excuse Grenade/Pyro': /pyro(technics)?|grenades?|explosives?/i,
  'Excuse Kneeling/Squatting': /kneel(ing)?|squat(ting)?/i,
  'Excuse Stay-In': /stay[\s-]?in/i,
};

/**
 * Maps a free-text Status `reason` to the buckets it names.
 * @param {*} reason Raw `reason` cell.
 * @returns {string[]} Matched buckets in STATUS_BUCKETS order; `['Other']` when the text
 *     is non-blank but matches none of the nine named restrictions; `[]` when blank.
 */
export function bucketsFor(reason) {
  const text = toText(reason);
  if (text === '') {
    return [];
  }
  const matched = STATUS_BUCKETS.filter((bucket) => {
    const pattern = BUCKET_PATTERNS[bucket];
    return pattern != null && pattern.test(text);
  });
  return matched.length > 0 ? matched : ['Other'];
}

/**
 * Whether a Status row is permanent rather than dated.
 *
 * Checks the `num_days` sentinel first, then falls back to /\bperm/i on the reason text —
 * see the file header for why the fallback is the one that actually fires today.
 * @param {!Object} row A Personnel Data record with `reason` and `num_days`.
 * @returns {boolean} True when the row is a permanent status.
 */
export function isPermanentStatus(row) {
  if (toNumber(row && row.num_days) === PERM_STATUS_NUM_DAYS) {
    return true;
  }
  return /\bperm/i.test(toText(row && row.reason));
}


/**
 * The restrictions in force on one parade, restriction by company: who cannot do what.
 *
 * A soldier with two restrictions counts once under each; a soldier listed in two
 * sessions counts once. 'Other' is left out: it names no activity to plan around.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {?string} session Session to restrict to, or null for both.
 * @returns {{rows: string[], cells: Array<{row: string, column: string, value: number,
 *     names: string[]}>}} Restrictions with anyone under them, in `STATUS_BUCKETS` order,
 *     and one cell per restriction and company with the soldiers' names, sorted.
 */
export function restrictionsOn(personnelRows, isoDate, session) {
  const byCell = new Map();
  personnelRows
    .filter(
      (row) =>
        toIsoDate(row.date) === isoDate &&
        (!session || toText(row.session) === session) &&
        classify(row) === DUTY_CLASS.STATUS
    )
    .forEach((row) => {
      const key = identityOf(row).key;
      if (key === '') return;
      bucketsFor(row.reason)
        .filter((bucket) => bucket !== 'Other')
        .forEach((bucket) => {
          const cellKey = bucket + '|' + toText(row.company);
          const soldiers = byCell.get(cellKey) || new Map();
          soldiers.set(key, (toText(row.rank) + ' ' + toText(row.name)).trim());
          byCell.set(cellKey, soldiers);
        });
    });
  const rows = STATUS_BUCKETS.filter((bucket) => COMPANIES.some((company) => byCell.has(bucket + '|' + company)));
  const cells = rows.flatMap((bucket) =>
    COMPANIES.map((company) => {
      const soldiers = byCell.get(bucket + '|' + company) || new Map();
      return { row: bucket, column: company, value: soldiers.size, names: Array.from(soldiers.values()).sort() };
    })
  );
  return { rows, cells };
}
