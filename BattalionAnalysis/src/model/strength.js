/**
 * Headcount against strength, for one day or across a range, battalion-wide or by company.
 *
 * `metrics.battalionStrength` already answers the single-day battalion question and is
 * reused rather than reimplemented — two functions computing "how many turned up" is how
 * a commander ends up seeing two different numbers for it. What is added here is the two
 * things it does not do: the rank tiers, whose columns have always been in Strength Data
 * and never read, and the by-company split every trend line on the Overview needs.
 *
 * **A company that did not file is a gap, not a zero.** Only 5 of 45 parade days in the
 * observed data carry all six companies, so this distinction is not an edge case — it is
 * most days. A zero would draw a line plunging to the floor and read as a catastrophe;
 * a null leaves the line broken, which is what actually happened.
 *
 * Every function here is pure.
 */

import { classify } from './classify.js';
import { COMPANIES, UNIT_TYPE_COMPANY } from './domain.js';
import { identityOf } from './identity.js';
import { battalionStrength, dutyCountsOn } from './metrics.js';
import { toIsoDate, toNumber, toText } from './values.js';

/**
 * The three rank tiers Strength Data breaks a company into.
 * @type {Array<{tier: string, label: string, strengthKey: string, presentKey: string}>}
 */
export const RANK_TIERS = [
  {
    tier: 'officer',
    label: 'Officer',
    strengthKey: 'officer_strength',
    presentKey: 'officer_present',
  },
  { tier: 'wospec', label: 'WOSpec', strengthKey: 'wospec_strength', presentKey: 'wospec_present' },
  {
    tier: 'enlistee',
    label: 'Enlistee',
    strengthKey: 'enlistee_strength',
    presentKey: 'enlistee_present',
  },
];

/**
 * The company-total rows for one parade.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {Array<!Object>} The `unit_type === 'Company'` rows for that parade.
 */
function companyRowsOn_(strengthRows, isoDate, session) {
  return strengthRows.filter(
    (row) =>
      toIsoDate(row.date) === isoDate &&
      toText(row.session) === session &&
      toText(row.unit_type) === UNIT_TYPE_COMPANY
  );
}

/**
 * The battalion's strength and present count on one parade.
 *
 * A thin naming layer over `metrics.battalionStrength`, so pages read `strengthOn` beside
 * `rankTiersOn` and `presentTrend` rather than reaching into two modules for one picture.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {!Object} Accountable and present strength, and which companies reported.
 */
export function strengthOn(strengthRows, isoDate, session) {
  return battalionStrength(strengthRows, isoDate, session);
}

/**
 * Strength and present count by rank tier on one parade.
 *
 * A blank tier cell means the message did not break that tier out, which is not the same
 * as nobody being in it. Such a cell contributes to neither total and is excluded from
 * `companiesReporting`, so a tier's figure always states how many companies it covers.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {Array<{tier: string, label: string, strength: ?number, present: ?number,
 *     share: ?number, companiesReporting: number}>} One entry per tier, in rank order.
 */
export function rankTiersOn(strengthRows, isoDate, session) {
  const rows = companyRowsOn_(strengthRows, isoDate, session);
  return RANK_TIERS.map((tier) => {
    const stated = rows.filter((row) => toNumber(row[tier.strengthKey]) !== null);
    const strength = stated.reduce((sum, row) => sum + toNumber(row[tier.strengthKey]), 0);
    const present = stated.reduce((sum, row) => sum + (toNumber(row[tier.presentKey]) || 0), 0);
    return {
      tier: tier.tier,
      label: tier.label,
      strength: stated.length > 0 ? strength : null,
      present: stated.length > 0 ? present : null,
      share: strength > 0 ? present / strength : null,
      companiesReporting: stated.length,
    };
  });
}

/**
 * Per-company accountable and present strength on one parade, keyed by company.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @returns {!Map<string, {strength: ?number, present: ?number}>} Only companies that filed.
 */
function companyStrengthOn_(strengthRows, isoDate, session) {
  const byCompany = new Map();
  companyRowsOn_(strengthRows, isoDate, session).forEach((row) => {
    byCompany.set(toText(row.company), {
      strength: toNumber(row.total_strength),
      present: toNumber(row.total_present),
    });
  });
  return byCompany;
}

/**
 * The percentage-present trend, battalion-wide or split into six company series.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string[]} dates Parade dates to plot, oldest first.
 * @param {{scope?: string, session?: string}=} options `scope` is 'battalion' (default)
 *     or 'companies'; `session` defaults to 'FPS'.
 * @returns {{dates: string[], series: Array<{name: string, values: Array<?number>}>}} One
 *     series for the battalion, or one per company, with null where nothing was filed.
 */
export function presentTrend(strengthRows, dates, options) {
  const scope = (options && options.scope) || 'battalion';
  const session = (options && options.session) || 'FPS';

  if (scope === 'companies') {
    const perDate = dates.map((date) => companyStrengthOn_(strengthRows, date, session));
    return {
      dates,
      series: COMPANIES.map((company) => ({
        name: company,
        values: perDate.map((byCompany) => {
          const entry = byCompany.get(company);
          if (!entry || !entry.strength) {
            return null;
          }
          return (entry.present / entry.strength) * 100;
        }),
      })),
    };
  }

  return {
    dates,
    series: [
      {
        name: 'Battalion',
        values: dates.map((date) => battalionStrength(strengthRows, date, session).percentPresent),
      },
    ],
  };
}

/**
 * Distinct-soldier counts of one duty class, by company, on one parade.
 *
 * `metrics.dutyCountsOn` only totals the battalion, so a per-company breakdown is
 * computed here the same way it does internally: dedup on identity within each company,
 * so a soldier appearing on both FPS and LPS is not counted twice.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session Parade session.
 * @param {string} dutyClass Duty class to count, from DUTY_CLASS.
 * @returns {!Map<string, number>} Company name to distinct-soldier count.
 */
function dutyCountsByCompany_(personnelRows, isoDate, session, dutyClass) {
  const seen = new Map();
  personnelRows
    .filter(
      (row) =>
        toIsoDate(row.date) === isoDate &&
        toText(row.session) === session &&
        classify(row) === dutyClass
    )
    .forEach((row) => {
      const identity = identityOf(row);
      if (identity.key === '') {
        return;
      }
      const company = toText(row.company);
      const bucket = seen.get(company) || new Set();
      bucket.add(identity.key);
      seen.set(company, bucket);
    });
  const counts = new Map();
  seen.forEach((keys, company) => counts.set(company, keys.size));
  return counts;
}

/**
 * A duty class counted per date, battalion-wide or split into six company series.
 *
 * The by-company denominator is that company's own accountable strength, so a large
 * company and a small one are comparable — the dashboard's standing rule that every
 * comparison is a rate rather than a count.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} dutyClass Duty class to trend, from DUTY_CLASS.
 * @param {string[]} dates Parade dates to plot, oldest first.
 * @param {{scope?: string, session?: string, asRate?: boolean}=} options `scope` is
 *     'battalion' (default) or 'companies'; `asRate` divides by strength, defaulting true.
 * @returns {{dates: string[], series: Array<{name: string, values: Array<?number>}>}} The
 *     series, with null where the unit filed nothing that day.
 */
export function dutyTrend(personnelRows, strengthRows, dutyClass, dates, options) {
  const scope = (options && options.scope) || 'battalion';
  const session = (options && options.session) || 'FPS';
  const asRate = !options || options.asRate !== false;

  if (scope === 'companies') {
    const perDate = dates.map((date) => ({
      strength: companyStrengthOn_(strengthRows, date, session),
      duty: dutyCountsByCompany_(personnelRows, date, session, dutyClass),
    }));
    return {
      dates,
      series: COMPANIES.map((company) => ({
        name: company,
        values: perDate.map((day) => {
          const entry = day.strength.get(company);
          if (!entry) {
            return null;
          }
          const count = day.duty.get(company) || 0;
          if (!asRate) {
            return count;
          }
          return entry.strength > 0 ? (count / entry.strength) * 100 : null;
        }),
      })),
    };
  }

  return {
    dates,
    series: [
      {
        name: 'Battalion',
        values: dates.map((date) => {
          const strength = battalionStrength(strengthRows, date, session);
          const count = dutyCountsOn(personnelRows, date, session).counts[dutyClass] || 0;
          if (!asRate) {
            return count;
          }
          return strength.accountable > 0 ? (count / strength.accountable) * 100 : null;
        }),
      },
    ],
  };
}
