/**
 * What the dashboard's numbers do not cover, computed once so every panel can print it.
 *
 * Only 5 of 45 parade days in the observed data carry all six companies, and the two
 * source spans differ — parade state from 2026-07-11, FormSG from 2026-05-07 — so "all
 * time" means different things on adjacent cards. Every figure here is a fraction with
 * both parts, numerator and denominator, never a bare percentage: a reader must be able
 * to see 5/45 and not only 11%.
 *
 * Every function here is pure.
 */

import { toIsoDate, toNumber, toText } from '../../../shared/values.js';
import { platoonCoverage } from './platoon.js';

/**
 * The first and last date a set of rows covers.
 * @param {Array<!Object>} rows Records with a date-bearing field readable by `toIsoDate`.
 * @param {string=} field The field to read; `date` unless named (FormSG rows carry `Timestamp`).
 * @returns {{from: ?string, to: ?string}} The span, or nulls when there are no rows.
 */
function dateSpan_(rows, field = 'date') {
  const dates = rows.map((row) => toIsoDate(row[field])).filter((date) => date !== null).sort();
  return dates.length === 0 ? { from: null, to: null } : { from: dates[0], to: dates[dates.length - 1] };
}

/**
 * The data-quality summary the Settings page renders.
 *
 * `dataset` is the shape `data/feed.js`'s `loadAll` returns: `strength`, `personnel`,
 * `roster`, `formSg`, `submissions`, `holidays`, `rotations`, and `available`/`notes` for
 * which optional tabs loaded.
 * @param {!Object} dataset The loaded dataset.
 * @returns {!Object} Row counts, tab availability, both date spans, platoon coverage, and
 *     the named findings below.
 */
export function dataQuality(dataset) {
  const personnel = dataset.personnel || [];
  const strength = dataset.strength || [];
  const formSg = dataset.formSg || [];

  const blankFourD = personnel.filter((row) => toText(row.four_d) === '').length;
  const statusRows = personnel.filter((row) => toText(row.reason_category) === 'Status');
  const attCRows = personnel.filter((row) => toText(row.reason_category) === 'Att C');
  const blankStatusDays = statusRows.filter((row) => toNumber(row.num_days) === null).length;
  const blankAttCDays = attCRows.filter((row) => toNumber(row.num_days) === null).length;
  const permReasonRows = statusRows.filter((row) => /\bperm\b/i.test(toText(row.reason)));
  const permSentinelRows = statusRows.filter((row) => toNumber(row.num_days) === 999);

  return {
    rowCounts: {
      strength: strength.length,
      personnel: personnel.length,
      roster: (dataset.roster || []).length,
      formSg: formSg.length,
      submissions: (dataset.submissions || []).length,
      holidays: (dataset.holidays || []).length,
      rotations: (dataset.rotations || []).length,
    },
    optionalTabs: dataset.notes || {},
    paradeStateSpan: dateSpan_(strength),
    formSgSpan: dateSpan_(formSg, 'Timestamp'),
    platoon: platoonCoverage(personnel),
    fourD: { total: personnel.length, blank: blankFourD },
    statusDuration: { total: statusRows.length, blank: blankStatusDays },
    attCDuration: { total: attCRows.length, blank: blankAttCDays },
    permanentStatusSentinel: {
      // The finding: rows that read as permanent in their own words, versus rows that
      // actually carry the sentinel the parser is supposed to write for one. In the
      // observed data the second number is always 0.
      readAsPermanent: permReasonRows.length,
      carryingSentinel: permSentinelRows.length,
    },
  };
}

/**
 * Sections whose stated count differs from the names listed under them, per company per
 * day: how often a parade state does not add up.
 * @param {Array<!Object>} sectionCounts "Section Counts" records: `parade_response_id`,
 *     `date`, `company`, `platoon`, `reason_category`, `stated_count`.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @returns {{cells: Array<{row: string, column: string, value: number, sections: string[]}>,
 *     checked: number, mismatched: number}} One cell per company-day with a stated count,
 *     valued in mismatched sections and naming them; sections checked and mismatched.
 */
export function countMismatches(sectionCounts, personnelRows) {
  const listed = new Map();
  personnelRows.forEach((row) => {
    const key = [toText(row.parade_response_id), toText(row.platoon), toText(row.reason_category)].join('|');
    listed.set(key, (listed.get(key) || 0) + 1);
  });
  const byDay = new Map();
  let checked = 0;
  let mismatched = 0;
  sectionCounts.forEach((row) => {
    const stated = toNumber(row.stated_count);
    if (stated === null) return;
    checked += 1;
    const key = [toText(row.parade_response_id), toText(row.platoon), toText(row.reason_category)].join('|');
    const cellKey = toText(row.company) + '|' + toIsoDate(row.date);
    const cell = byDay.get(cellKey) || { row: toText(row.company), column: toIsoDate(row.date), value: 0, sections: [] };
    const count = listed.get(key) || 0;
    if (count !== stated) {
      mismatched += 1;
      cell.value += 1;
      cell.sections.push((toText(row.platoon) || 'Company') + ' ' + toText(row.reason_category) + ': states ' + stated + ', lists ' + count);
    }
    byDay.set(cellKey, cell);
  });
  return { cells: Array.from(byDay.values()), checked, mismatched };
}
