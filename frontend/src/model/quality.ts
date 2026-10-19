/**
 * What the dashboard's numbers do not cover, as fractions with both parts (5 of 45, never just 11%):
 * row counts, the two sources' date spans, and the gaps the Filing & Accuracy page reports.
 */

import { toIsoDate, toNumber, toText } from '../../../shared/values.ts';
import { PERM_STATUS_NUM_DAYS } from '../../../shared/domain.ts';
import type { PersonnelRow, SectionCountRow } from '../../../shared/dashboard.ts';
import type { Dataset } from '../data/feed.ts';
import { platoonCoverage } from './platoon.ts';
import type { Cell } from './metrics.ts';

/** A span of dates; nulls when there are no rows. */
interface DateSpan {
  from: string | null;
  to: string | null;
}

/** A part of a whole. */
interface Fraction {
  total: number;
  blank: number;
}

/** The data-quality summary the Filing & Accuracy page renders. */
export interface DataQuality {
  rowCounts: Record<string, number>;
  /** Why an optional dataset or calendar list is empty. */
  notes: Record<string, string>;
  paradeStateSpan: DateSpan;
  formSgSpan: DateSpan;
  platoon: ReturnType<typeof platoonCoverage>;
  fourD: Fraction;
  statusDuration: Fraction;
  attCDuration: Fraction;
  /** Status rows that read as permanent, versus rows carrying the sentinel the parser should write (always 0 so far). */
  permanentStatusSentinel: { readAsPermanent: number; carryingSentinel: number };
}

/** The first and last date in a list of date-bearing values. */
function dateSpan(values: unknown[]): DateSpan {
  const dates = values.map(toIsoDate).filter((date) => date !== null).sort();
  return { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null };
}

/** Rows in a section, and how many of them state no duration. */
function blankDuration(rows: PersonnelRow[]): Fraction {
  return { total: rows.length, blank: rows.filter((row) => toNumber(row.numDays) === null).length };
}

/** The data-quality summary of a loaded dataset. */
export function dataQuality(dataset: Dataset): DataQuality {
  const { personnel, strength, formSg } = dataset;
  const statusRows = personnel.filter((row) => row.reasonCategory === 'Status');
  return {
    rowCounts: {
      strength: strength.length,
      personnel: personnel.length,
      roster: dataset.roster.length,
      formSg: formSg.length,
      submissions: dataset.submissions.length,
      holidays: dataset.holidays.length,
      rotations: dataset.rotations.length,
    },
    notes: dataset.notes,
    paradeStateSpan: dateSpan(strength.map((row) => row.date)),
    formSgSpan: dateSpan(formSg.map((row) => row.timestamp)),
    platoon: platoonCoverage(personnel),
    fourD: { total: personnel.length, blank: personnel.filter((row) => toText(row.fourD) === '').length },
    statusDuration: blankDuration(statusRows),
    attCDuration: blankDuration(personnel.filter((row) => row.reasonCategory === 'Att C')),
    permanentStatusSentinel: {
      readAsPermanent: statusRows.filter((row) => /\bperm\b/i.test(toText(row.reason))).length,
      carryingSentinel: statusRows.filter((row) => toNumber(row.numDays) === PERM_STATUS_NUM_DAYS).length,
    },
  };
}

/** A company-day naming the sections whose stated count differs from the names listed. */
export interface MismatchCell extends Cell {
  sections: string[];
}

/** How often a parade state does not add up: per company-day, sections whose stated count differs from the names listed. */
export function countMismatches(
  sectionCounts: SectionCountRow[],
  personnelRows: PersonnelRow[],
): { cells: MismatchCell[]; checked: number; mismatched: number } {
  const sectionKey = (row: { paradeResponseId: string; platoon: string; reasonCategory: string }) =>
    [row.paradeResponseId, row.platoon, row.reasonCategory].join('|');
  const listed = new Map<string, number>();
  for (const row of personnelRows) listed.set(sectionKey(row), (listed.get(sectionKey(row)) ?? 0) + 1);

  const byDay = new Map<string, MismatchCell>();
  let checked = 0;
  let mismatched = 0;
  for (const row of sectionCounts) {
    if (row.statedCount === null) continue;
    checked += 1;
    const cellKey = row.company + '|' + row.date;
    const cell = byDay.get(cellKey) ?? { row: row.company, column: row.date, value: 0, sections: [] };
    const count = listed.get(sectionKey(row)) ?? 0;
    if (count !== row.statedCount) {
      mismatched += 1;
      cell.value += 1;
      cell.sections.push(`${row.platoon || 'Company'} ${row.reasonCategory}: states ${row.statedCount}, lists ${count}`);
    }
    byDay.set(cellKey, cell);
  }
  return { cells: Array.from(byDay.values()), checked, mismatched };
}
