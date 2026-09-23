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

import {
  COMPANIES,
  COMPANY_SUBUNITS,
  PLATOONS,
  SUBUNIT_POSITIONS,
  UNASSIGNED,
  subunitPosition,
} from './domain.js';
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

/**
 * Re-keys company x platoon cells onto the position columns of `SUBUNIT_POSITIONS`.
 *
 * Every sub-unit a company has gets a cell, a zero included, so the grid names each
 * company's own platoon in place (`cell.platoon`) even where nothing happened. A cell whose
 * platoon the company does not have — a blank platoon, or a stray label — cannot be placed
 * and is counted in `unplaced` instead of being drawn under a column it does not belong to.
 * @param {Array<{row: string, column: string, value: number, inferred?: boolean}>} cells
 *     Counts keyed by company (`row`) and platoon as written (`column`).
 * @returns {{cells: Array<{row: string, column: string, platoon: string, value: number,
 *     inferred: boolean}>, unplaced: number}} Position cells, in COMPANIES then position
 *     order, and the total value that fitted no position.
 */
export function toPositionCells(cells) {
  const byKey = new Map();
  let unplaced = 0;
  cells.forEach((cell) => {
    const position = subunitPosition(cell.row, cell.column);
    if (position < 0) {
      unplaced += cell.value || 0;
      return;
    }
    const key = cell.row + '\u0000' + position;
    const entry = byKey.get(key) || { value: 0, inferred: false };
    entry.value += cell.value || 0;
    entry.inferred = entry.inferred || Boolean(cell.inferred);
    byKey.set(key, entry);
  });

  const placed = COMPANIES.flatMap((company) =>
    (COMPANY_SUBUNITS[company] || []).map((platoon, position) => {
      const entry = byKey.get(company + '\u0000' + position) || { value: 0, inferred: false };
      return {
        row: company,
        column: SUBUNIT_POSITIONS[position],
        platoon: platoon === 'HQ' ? 'Coy HQ' : platoon,
        value: entry.value,
        inferred: entry.inferred,
      };
    })
  );
  return { cells: placed, unplaced };
}

/**
 * What each position column means, company by company, for a heatmap's key.
 * @returns {Array<{column: string, units: Array<{company: string, platoon: string}>}>} One
 *     entry per `SUBUNIT_POSITIONS` column, listing the companies that have a sub-unit there.
 */
export function positionKey() {
  return SUBUNIT_POSITIONS.map((column, position) => ({
    column,
    units: COMPANIES.filter((company) => (COMPANY_SUBUNITS[company] || [])[position]).map(
      (company) => ({ company, platoon: COMPANY_SUBUNITS[company][position] })
    ),
  }));
}
