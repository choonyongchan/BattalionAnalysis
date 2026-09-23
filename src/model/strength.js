/**
 * Headcount against strength, for one day or across a range, battalion-wide or by company.
 *
 * `metrics.battalionStrength` already answers the single-day battalion question and is
 * reused rather than reimplemented — two functions computing "how many turned up" is how
 * a commander ends up seeing two different numbers for it. What is added here is the
 * by-company split every trend line on the Overview needs.
 *
 * **A company that did not file is a gap, not a zero.** Only 5 of 45 parade days in the
 * observed data carry all six companies, so this distinction is not an edge case — it is
 * most days. A zero would draw a line plunging to the floor and read as a catastrophe;
 * a null leaves the line broken, which is what actually happened.
 *
 * Every function here is pure.
 */

import { classify, dutyList, isDuty } from './classify.js';
import { COMPANIES, UNIT_TYPE_COMPANY } from './domain.js';
import { identityOf } from './identity.js';
import { battalionStrength, dutyCountsOn } from './metrics.js';
import { toIsoDate, toNumber, toText } from './values.js';


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
 * The three rank tiers a parade state splits its strength into, in command order.
 *
 * `key` is the column prefix in Strength Data (`officer_strength`, `officer_present`, ...).
 * @type {Array<{key: string, label: string}>}
 */
export const RANK_TIERS = [
  { key: 'officer', label: 'Officers' },
  { key: 'wospec', label: 'WOSpecs' },
  { key: 'enlistee', label: 'Enlistees' },
];

/**
 * One tier's strength and presence off a company row, or null when the row does not state it.
 * @param {!Object} row A `unit_type === 'Company'` Strength Data record.
 * @param {string} key A RANK_TIERS key.
 * @returns {?{strength: number, present: number}} The stated pair, or null.
 */
function tierOf_(row, key) {
  const strength = toNumber(row[key + '_strength']);
  const present = toNumber(row[key + '_present']);
  return strength === null || present === null ? null : { strength, present };
}

/**
 * Sums stated tier pairs into one entry with its percentage present.
 * @param {{key: string, label: string}} tier The tier.
 * @param {Array<?{strength: number, present: number}>} pairs One pair per company; null
 *     where that company did not state this tier.
 * @returns {{key: string, label: string, strength: ?number, present: ?number,
 *     percent: ?number}} The tier's totals; all null when no company stated it.
 */
function tierTotal_(tier, pairs) {
  const stated = pairs.filter((pair) => pair !== null);
  if (stated.length === 0) {
    return { key: tier.key, label: tier.label, strength: null, present: null, percent: null };
  }
  const strength = stated.reduce((total, pair) => total + pair.strength, 0);
  const present = stated.reduce((total, pair) => total + pair.present, 0);
  return {
    key: tier.key,
    label: tier.label,
    strength,
    present,
    percent: strength > 0 ? (present / strength) * 100 : null,
  };
}

/**
 * Presence by rank tier on one parade: battalion-wide, and for each company that filed.
 *
 * A company can be at 90% and still be missing half its officers, which the total hides.
 * A tier a company did not state is left out of that tier's battalion sum rather than read
 * as zero, and the companies that stated no split at all are named.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string=} session Parade session; defaults to 'FPS'.
 * @returns {{battalion: Array<!Object>, byCompany: Array<{company: string,
 *     tiers: Array<!Object>}>, companiesWithoutSplit: string[]}} Tier totals in
 *     RANK_TIERS order, battalion-wide and per company in COMPANIES order.
 */
export function tierPresence(strengthRows, isoDate, session) {
  const rows = companyRowsOn_(strengthRows, isoDate, session || 'FPS');
  const byName = new Map(rows.map((row) => [toText(row.company), row]));
  const filed = COMPANIES.filter((company) => byName.has(company));

  const byCompany = filed.map((company) => ({
    company,
    tiers: RANK_TIERS.map((tier) => tierTotal_(tier, [tierOf_(byName.get(company), tier.key)])),
  }));
  const battalion = RANK_TIERS.map((tier) =>
    tierTotal_(tier, filed.map((company) => tierOf_(byName.get(company), tier.key)))
  );

  return {
    battalion,
    byCompany,
    companiesWithoutSplit: byCompany
      .filter((entry) => entry.tiers.every((tier) => tier.strength === null))
      .map((entry) => entry.company),
  };
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
 * The present-headcount trend, battalion-wide or split into six company series.
 *
 * This is the one trend on the Overview reported as a count rather than a rate: it answers
 * "how many soldiers do I have", which is a number of bodies, not a ratio. Because the
 * companies split therefore compares raw headcounts, a large company sits above a small one
 * for reasons that are not performance — the rank tiers and the rate trends below it are
 * where companies are compared like for like.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string[]} dates Parade dates to plot, oldest first.
 * @param {{scope?: string, session?: string}=} options `scope` is 'battalion' (default)
 *     or 'companies'; `session` defaults to 'FPS'.
 * @returns {{dates: string[], series: Array<{name: string, values: Array<?number>}>}} One
 *     series of present soldiers for the battalion, or one per company, with null where
 *     nothing was filed.
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
          return entry ? entry.present : null;
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
          // `battalionStrength` sums an empty day to 0, which as a headcount would draw the
          // battalion line falling to the floor on every day nobody filed. A day with no
          // parade state is missing data, so it stays a gap — the same rule the percentage
          // got for free from its `accountable > 0` guard.
          const strength = battalionStrength(strengthRows, date, session);
          return strength.companiesReporting.length === 0 ? null : strength.present;
        }),
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
 * @param {string|!Array<string>} dutyClass Duty class(es) to count, from DUTY_CLASS.
 * @returns {!Map<string, number>} Company name to distinct-soldier count.
 */
function dutyCountsByCompany_(personnelRows, isoDate, session, dutyClass) {
  const seen = new Map();
  personnelRows
    .filter(
      (row) =>
        toIsoDate(row.date) === isoDate &&
        toText(row.session) === session &&
        isDuty(dutyClass, classify(row))
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
 * As a rate (the default), the by-company denominator is that company's own accountable
 * strength, so a large company and a small one are comparable. `asRate: false` gives the
 * raw headcount instead, which is what the Overview's trends ask for: a commander reading
 * the front page wants to know how many soldiers are affected, not a normalised ratio.
 * Either way a company that filed no strength row that day is a gap, never a zero.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string|!Array<string>} dutyClass Duty class(es) to trend, from DUTY_CLASS.
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
          // Several classes sum, as the Overview's MC / MA tile has always summed them.
          const counts = dutyCountsOn(personnelRows, date, session).counts;
          const count = dutyList(dutyClass).reduce((sum, name) => sum + (counts[name] || 0), 0);
          if (!asRate) {
            return count;
          }
          return strength.accountable > 0 ? (count / strength.accountable) * 100 : null;
        }),
      },
    ],
  };
}
