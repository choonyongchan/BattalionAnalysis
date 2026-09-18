/**
 * Restricting the loaded data to one company.
 *
 * The dashboard's standing rule is that every comparison is a rate — a unit's own
 * numerator over its own denominator. That is what lets one filter live here, above the
 * model layer, rather than threading a `company` argument through twenty functions:
 * filter every row array to the chosen company once, and each rate falls out of the same
 * rows it always did. `ALL` — and any value that is not one of the six companies — is an
 * identity passthrough that returns the input untouched, so an unused filter costs
 * nothing and changes nothing.
 *
 * Two inputs are handled apart from the rest. The raw FormSG rows carry no clean company
 * column — the company is a free-text "Unit & Coy" answer that only `toSubmissions`
 * resolves — so submissions are scoped after normalisation by `scopeSubmissions`. The
 * parade-state filing records behind the Overview timeline are never scoped here at all:
 * `model/submissions.js`'s `filingsOn` always pads to six companies because absence is
 * the point, so that view is filtered at its output instead.
 *
 * Every function here is pure.
 */

import { COMPANIES } from './domain.js';
import { toText } from './values.js';

/** @type {string} The selector value meaning the whole battalion. */
export const ALL_COMPANIES = 'ALL';

/**
 * Whether a selector value names one of the six companies.
 * @param {string} company The selector value.
 * @returns {boolean} True when `company` is a real company, not `ALL` or unknown.
 */
function isCompany_(company) {
  return COMPANIES.includes(company);
}

/**
 * Restricts a loaded dataset's row arrays to one company.
 *
 * `personnel`, `strength` and `roster` all carry a `company` cell on every row, so they
 * are filtered directly. `formSg` is left as-is — its company is not a column — and is
 * scoped later by `scopeSubmissions`.
 * @param {?Object} data A dataset as returned by `data/feed.js`'s `loadAll`.
 * @param {string} company A `COMPANIES` entry, or `ALL_COMPANIES`.
 * @returns {?Object} `data` unchanged when `company` is not a real company; otherwise a
 *     shallow clone with `personnel`, `strength` and `roster` filtered to `company`.
 */
export function scopeDataset(data, company) {
  if (!data || !isCompany_(company)) {
    return data;
  }
  const only = (rows) => (rows || []).filter((row) => toText(row.company) === company);
  return {
    ...data,
    personnel: only(data.personnel),
    strength: only(data.strength),
    roster: only(data.roster),
  };
}

/**
 * Restricts normalised FormSG submissions to one company.
 *
 * A submission whose "Unit & Coy" answer named no known company has a blank `company` and
 * is dropped for a specific company — it cannot be attributed — but kept for `ALL`.
 * @param {Array<!Object>} submissions Submissions from `model/formsg.js`'s `toSubmissions`.
 * @param {string} company A `COMPANIES` entry, or `ALL_COMPANIES`.
 * @returns {Array<!Object>} The same array when `company` is not a real company; otherwise
 *     only the submissions belonging to `company`.
 */
export function scopeSubmissions(submissions, company) {
  if (!isCompany_(company)) {
    return submissions;
  }
  return (submissions || []).filter((submission) => submission.company === company);
}

/**
 * Filters filing entries (from `model/submissions.js`'s `filingsOn`) to one company.
 *
 * `filingsOn` always returns all six companies so the Overview timeline can show which
 * did not file; when a single company is selected the timeline shows just that lane.
 * @param {Array<!Object>} entries Entries from `filingsOn`, each with a `company` field.
 * @param {string} company A `COMPANIES` entry, or `ALL_COMPANIES`.
 * @returns {Array<!Object>} The same array for `ALL`; otherwise the one matching entry.
 */
export function scopeFilings(entries, company) {
  if (!isCompany_(company)) {
    return entries;
  }
  return (entries || []).filter((entry) => entry.company === company);
}
