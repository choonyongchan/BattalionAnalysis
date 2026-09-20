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

import { UNIT_TYPE_COMPANY } from './domain.js';
import { COMPANIES } from './domain.js';
import { toIsoDate, toNumber, toText } from './values.js';
import { withinRange } from './dateRange.js';
import { platoonCoverage } from './platoon.js';

/**
 * The distinct parade dates a Strength Data slice covers, in range.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {?string} from Inclusive lower bound, or null for open.
 * @param {?string} to Inclusive upper bound, or null for open.
 * @returns {string[]} Sorted distinct ISO dates.
 */
function datesInRange_(strengthRows, from, to) {
  const dates = new Set();
  strengthRows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (date && withinRange(date, from, to)) {
      dates.add(date);
    }
  });
  return Array.from(dates).sort();
}

/**
 * How many of a range's parade days each company filed a company total for.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {?string} from Inclusive lower bound, or null for open.
 * @param {?string} to Inclusive upper bound, or null for open.
 * @returns {Array<{company: string, days: number, expectedDays: number, share: number}>}
 *     One entry per company, in COMPANIES order.
 */
export function companyCoverage(strengthRows, from, to) {
  const expectedDays = datesInRange_(strengthRows, from, to).length;
  const byCompany = new Map(COMPANIES.map((company) => [company, new Set()]));

  strengthRows.forEach((row) => {
    const date = toIsoDate(row.date);
    const company = toText(row.company);
    if (
      date &&
      withinRange(date, from, to) &&
      toText(row.unit_type) === UNIT_TYPE_COMPANY &&
      byCompany.has(company)
    ) {
      byCompany.get(company).add(date);
    }
  });

  return COMPANIES.map((company) => {
    const days = byCompany.get(company).size;
    return {
      company,
      days,
      expectedDays,
      share: expectedDays === 0 ? 0 : days / expectedDays,
    };
  });
}

/**
 * How many of a range's parade days had all six companies filing.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {?string} from Inclusive lower bound, or null for open.
 * @param {?string} to Inclusive upper bound, or null for open.
 * @returns {{days: number, fullDays: number, share: number}} Parade days in range, how
 *     many were complete, and the share.
 */
export function paradeDayCoverage(strengthRows, from, to) {
  const byDate = new Map();
  strengthRows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (!date || !withinRange(date, from, to) || toText(row.unit_type) !== UNIT_TYPE_COMPANY) {
      return;
    }
    const companies = byDate.get(date) || new Set();
    companies.add(toText(row.company));
    byDate.set(date, companies);
  });

  const days = byDate.size;
  const fullDays = Array.from(byDate.values()).filter((set) => set.size === COMPANIES.length).length;
  return { days, fullDays, share: days === 0 ? 0 : fullDays / days };
}

/**
 * The first and last date a set of rows covers.
 * @param {Array<!Object>} rows Records with a `date` field readable by `toIsoDate`.
 * @returns {{from: ?string, to: ?string}} The span, or nulls when there are no rows.
 */
function dateSpan_(rows) {
  const dates = rows.map((row) => toIsoDate(row.date)).filter((date) => date !== null).sort();
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
    formSgSpan: dateSpan_(formSg),
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
