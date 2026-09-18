/**
 * Infers a platoon from the 4D when a Personnel Data row states none.
 *
 * `platoon` is blank for whole companies — Hercules, Cougar, Braves and Stallion among
 * them — which would leave a Company x Platoon heatmap empty for half the battalion.
 * `four_d` encodes the platoon in its leading digit (optionally behind a single
 * company-letter prefix, e.g. `C1204`), so it stands in when the cell itself is silent.
 *
 * This is the one place in the model that derives a value the message does not state,
 * against `docs/architecture_patterns.md`'s "read what the message says; derive nothing".
 * The exception is deliberate and bounded: a stated platoon always wins, never the 4D, so
 * the derived value only ever fills a gap and never overrides what was actually read.
 *
 * Every function here is pure.
 */

import { PLATOONS, UNASSIGNED } from './domain.js';
import { toText } from './values.js';

/**
 * Reads the platoon digit that leads a 4D, skipping an optional single letter prefix.
 * @param {*} fourD Raw 4D cell; may be a string or a Sheets-coerced number.
 * @returns {string} '1'-'4' when the leading digit is a platoon, or '' when it is not.
 */
function platoonDigitOf_(fourD) {
  const text = toText(fourD).toUpperCase();
  const match = /^[A-Z]?([0-9])/.exec(text);
  if (!match) {
    return '';
  }
  const digit = match[1];
  return digit >= '1' && digit <= '4' ? digit : '';
}

/**
 * Normalises a stated platoon cell to the PLATOONS roll.
 * @param {*} platoon Raw platoon cell.
 * @returns {string} A member of PLATOONS, or '' when the cell states none.
 */
function normaliseStated_(platoon) {
  const text = toText(platoon).toUpperCase();
  return PLATOONS.includes(text) ? text : '';
}

/**
 * Resolves a row's platoon, stating it when the row does and inferring it otherwise.
 * @param {!Object} row A Personnel Data record with `platoon` and `four_d`.
 * @returns {{platoon: string, inferred: boolean}} The platoon and whether it was inferred.
 */
export function platoonOf(row) {
  const stated = normaliseStated_(row && row.platoon);
  if (stated !== '') {
    return { platoon: stated, inferred: false };
  }
  const digit = platoonDigitOf_(row && row.four_d);
  if (digit !== '') {
    return { platoon: digit, inferred: true };
  }
  return { platoon: UNASSIGNED, inferred: false };
}

/**
 * Summarises how much of a row set states its platoon versus needs it inferred.
 * @param {Array<!Object>} rows Personnel Data records.
 * @returns {{total: number, stated: number, inferred: number, unknown: number,
 *     inferredShare: number}} Counts, plus inferred as a 0..1 share of total.
 */
export function platoonCoverage(rows) {
  const total = rows.length;
  let stated = 0;
  let inferred = 0;
  rows.forEach((row) => {
    const result = platoonOf(row);
    if (result.inferred) {
      inferred += 1;
    } else if (result.platoon !== UNASSIGNED) {
      stated += 1;
    }
  });
  const unknown = total - stated - inferred;
  return {
    total,
    stated,
    inferred,
    unknown,
    inferredShare: total === 0 ? 0 : inferred / total,
  };
}
