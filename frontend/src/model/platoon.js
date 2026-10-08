/**
 * Resolves a soldier's platoon from the sub-header their line sits under.
 *
 * The sub-header (`unit_label`, read by `backend/lib/dashboard.ts#platoonOf`) is the
 * platoon: `7`, `SIG`, `OPR+ASA`, `HQ`. It counts only when the soldier's company has that
 * sub-unit (`COMPANY_SUBUNITS`); anything else is Unassigned.
 *
 * The 4D also encodes a platoon in its leading digit (optionally behind one company letter,
 * e.g. `C1204`). That reading is supported but switched off (`USE_FOURD_PLATOON`) until the
 * 4D scheme is confirmed: with it on, a 4D digit fills a missing sub-header and is marked
 * `inferred`, and it never overrides a stated sub-header.
 *
 * Every function here is pure.
 */

import { COMPANIES, COMPANY_SUBUNITS, SUBUNIT_POSITIONS, UNASSIGNED, subunitPosition } from '../../../shared/domain.js';
import { toText } from '../../../shared/values.js';

/**
 * Whether a 4D digit may stand in for a missing sub-header.
 * ponytail: off until the 4D scheme is confirmed; flip to true to fill gaps from the 4D.
 * @type {boolean}
 */
export const USE_FOURD_PLATOON = false;

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
 * The company's own name for a platoon cell, or '' when the company has no such sub-unit.
 * @param {string} company Company name.
 * @param {*} platoon Raw platoon cell.
 * @returns {string} A member of `COMPANY_SUBUNITS[company]`, or ''.
 */
function subunitOf_(company, platoon) {
  const position = subunitPosition(company, toText(platoon));
  return position < 0 ? '' : COMPANY_SUBUNITS[company][position];
}

/**
 * Resolves a row's platoon from its sub-header.
 * @param {!Object} row A record with `company`, `platoon` (the sub-header) and `four_d`.
 * @param {boolean=} useFourD Whether a 4D digit may fill a missing sub-header.
 * @returns {{platoon: string, inferred: boolean, fourD: string}} The platoon, whether it
 *     came from the 4D, and the platoon the 4D alone suggests ('' when none).
 */
export function platoonOf(row, useFourD = USE_FOURD_PLATOON) {
  const company = toText(row && row.company);
  const fourD = subunitOf_(company, platoonDigitOf_(row && row.four_d));
  const stated = subunitOf_(company, row && row.platoon);
  if (stated !== '') {
    return { platoon: stated, inferred: false, fourD };
  }
  if (useFourD && fourD !== '') {
    return { platoon: fourD, inferred: true, fourD };
  }
  return { platoon: UNASSIGNED, inferred: false, fourD };
}

/**
 * Summarises how many rows sit under a known sub-header, and how often the 4D agrees.
 * @param {Array<!Object>} rows Personnel Data records.
 * @returns {{total: number, stated: number, unknown: number, fourDDisagrees: number}}
 *     Rows under a known sub-header, rows without one, and stated rows whose 4D names a
 *     different platoon (the check to run before switching `USE_FOURD_PLATOON` on).
 */
export function platoonCoverage(rows) {
  let stated = 0;
  let fourDDisagrees = 0;
  rows.forEach((row) => {
    const result = platoonOf(row, false);
    if (result.platoon === UNASSIGNED) return;
    stated += 1;
    if (result.fourD !== '' && result.fourD !== result.platoon) fourDDisagrees += 1;
  });
  return { total: rows.length, stated, unknown: rows.length - stated, fourDDisagrees };
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
