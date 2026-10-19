/**
 * A soldier's platoon is the sub-header their line sits under, when their company has that sub-unit.
 * The 4D's leading digit (after an optional company letter, e.g. `C1204`) can also name a platoon;
 * that reading is off until the 4D scheme is confirmed.
 */

import { COMPANIES, COMPANY_SUBUNITS, SUBUNIT_POSITIONS, UNASSIGNED, isCompany, subunitPosition } from '../../../shared/domain.ts';
import { toText } from '../../../shared/values.ts';
import type { Cell } from './metrics.ts';

/**
 * Whether a 4D digit may fill a missing sub-header (never overriding a stated one).
 * ponytail: off until the 4D scheme is confirmed; flip to true to fill gaps from the 4D.
 */
export const USE_FOURD_PLATOON = false;

/** A row carrying a company, a sub-header and a 4D. */
type PlatoonRow = { company?: string | null; platoon?: string | null; fourD?: string | null };

/** A row's resolved platoon, whether it came from the 4D, and what the 4D alone suggests ('' when none). */
export interface PlatoonReading {
  platoon: string;
  inferred: boolean;
  fourD: string;
}

/** The platoon digit leading a 4D ('1'-'4'), or ''. */
function platoonDigitOf(fourD: unknown): string {
  const digit = /^[A-Z]?([0-9])/.exec(toText(fourD).toUpperCase())?.[1] ?? '';
  return digit >= '1' && digit <= '4' ? digit : '';
}

/** The company's own name for a platoon cell, or '' when it has no such sub-unit. */
function subunitOf(company: string, platoon: unknown): string {
  const position = subunitPosition(company, toText(platoon));
  return position < 0 || !isCompany(company) ? '' : COMPANY_SUBUNITS[company][position]!;
}

/** Resolves a row's platoon from its sub-header (or, when allowed, its 4D). */
export function platoonOf(row: PlatoonRow, useFourD = USE_FOURD_PLATOON): PlatoonReading {
  const company = toText(row.company);
  const fourD = subunitOf(company, platoonDigitOf(row.fourD));
  const stated = subunitOf(company, row.platoon);
  if (stated !== '') return { platoon: stated, inferred: false, fourD };
  if (useFourD && fourD !== '') return { platoon: fourD, inferred: true, fourD };
  return { platoon: UNASSIGNED, inferred: false, fourD };
}

/** Rows under a known sub-header, rows without one, and stated rows whose 4D disagrees (check before enabling the 4D). */
export function platoonCoverage(rows: PlatoonRow[]): { total: number; stated: number; unknown: number; fourDDisagrees: number } {
  let stated = 0;
  let fourDDisagrees = 0;
  for (const row of rows) {
    const result = platoonOf(row, false);
    if (result.platoon === UNASSIGNED) continue;
    stated += 1;
    if (result.fourD !== '' && result.fourD !== result.platoon) fourDDisagrees += 1;
  }
  return { total: rows.length, stated, unknown: rows.length - stated, fourDDisagrees };
}

/** A company x platoon count, keyed by company (`row`) and platoon as written (`column`). */
export interface PlatoonCell extends Cell {
  inferred?: boolean;
}

/** A count placed under its sub-unit position column, naming the company's own platoon. */
export interface PositionCell extends Cell {
  platoon: string;
  inferred: boolean;
}

/** Re-keys platoon cells onto `SUBUNIT_POSITIONS` (zeros included); counts that fit no position go to `unplaced`. */
export function toPositionCells(cells: PlatoonCell[]): { cells: PositionCell[]; unplaced: number } {
  const byKey = new Map<string, { value: number; inferred: boolean }>();
  let unplaced = 0;
  for (const cell of cells) {
    const position = subunitPosition(cell.row, cell.column);
    if (position < 0) {
      unplaced += cell.value || 0;
      continue;
    }
    const key = cell.row + '\u0000' + position;
    const entry = byKey.get(key) ?? { value: 0, inferred: false };
    entry.value += cell.value || 0;
    entry.inferred ||= Boolean(cell.inferred);
    byKey.set(key, entry);
  }
  const placed = COMPANIES.flatMap((company) =>
    COMPANY_SUBUNITS[company].map((platoon, position) => {
      const entry = byKey.get(company + '\u0000' + position) ?? { value: 0, inferred: false };
      return {
        row: company,
        column: SUBUNIT_POSITIONS[position]!,
        platoon: platoon === 'HQ' ? 'Coy HQ' : platoon,
        value: entry.value,
        inferred: entry.inferred,
      };
    }),
  );
  return { cells: placed, unplaced };
}
