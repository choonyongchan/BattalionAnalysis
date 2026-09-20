/**
 * Folds Personnel Data's free-text `location` cell into a canonical clinic name.
 *
 * 177 distinct strings name a handful of real institutions: Changi General Hospital alone
 * is written six different ways, from the bare abbreviation to a full department address
 * that merely happens to end in "CGH". Matching is therefore substring-based rather than
 * exact, so a department suffix folds into its hospital, and each alias is chosen to be
 * specific enough that it cannot also match a different institution's alias.
 *
 * A clinic the lexicon has not met yet is never dropped or lumped into "Other" — it is
 * real data about a real place, so it survives, title-cased for a consistent chart legend.
 *
 * Every function here is pure.
 */

import { toText } from './values.js';

/**
 * Alias patterns, each matched against the upper-cased raw cell. Patterns are written to
 * be mutually exclusive, so match order does not change the outcome.
 * @type {Array<{canonical: string, pattern: !RegExp}>}
 */
const LOCATION_ALIASES = [
  { canonical: 'Changi General Hospital', pattern: /\bCGH\b|CHANGI\s*GENERAL\s*HOSPITAL/i },
  { canonical: 'Ng Teng Fong General Hospital', pattern: /NG\s*TENG\s*FONG/i },
  { canonical: 'National University Hospital', pattern: /\bNUH\b|NATIONAL\s*UNIVERSITY\s*HOSPITAL/i },
  { canonical: 'Singapore General Hospital', pattern: /\bSGH\b|SINGAPORE\s*GENERAL\s*HOSPITAL/i },
  { canonical: 'CMPB', pattern: /\bCMPB\b/i },
  { canonical: 'Khoo Teck Puat Hospital', pattern: /KHOO\s*TECK\s*PUAT|\bKTPH\b/i },
  { canonical: 'Alexandra Hospital', pattern: /ALEXANDRA\s*HOSPITAL/i },
  { canonical: 'Carehub@BMTC', pattern: /CAREHUB/i },
  { canonical: 'Institute of Mental Health', pattern: /\bIMH\b|INSTITUTE\s*OF\s*MENTAL\s*HEALTH/i },
  { canonical: 'Singapore Changi Aeromedical Centre', pattern: /AEROMED/i },
  { canonical: 'Kallang Polyclinic', pattern: /KALLANG\s*POLYCLINIC/i },
  { canonical: 'Woodlands Polyclinic', pattern: /WOODLANDS\s*POLYCLINIC/i },
  { canonical: 'Asiamedic Orchard Imaging Centre', pattern: /ASIAMEDIC/i },
];

/**
 * Title-cases free text for consistent display, without inventing new capitalisation
 * inside a word (so "walk-in" stays "Walk-in", not "Walk-In").
 * @param {string} text Trimmed text.
 * @returns {string} Title-cased text.
 */
function titleCase_(text) {
  return text
    .split(/\s+/)
    .map((word) => (word === '' ? word : word[0].toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ');
}

/**
 * Canonicalises a free-text clinic/hospital cell.
 * @param {*} text Raw `location` cell.
 * @returns {string} The canonical name, the input title-cased when unrecognised, or ''
 *     when the cell is blank.
 */
export function canonicalLocation(text) {
  const trimmed = toText(text);
  if (trimmed === '') {
    return '';
  }
  const upper = trimmed.toUpperCase();
  const alias = LOCATION_ALIASES.find((entry) => entry.pattern.test(upper));
  return alias ? alias.canonical : titleCase_(trimmed);
}

/**
 * Counts rows per canonical location, with the raw strings that folded into each.
 * @param {Array<!Object>} rows Personnel Data records.
 * @param {{category: string}=} options Restricts to one `reason_category` when given.
 * @returns {Array<{location: string, count: number, variants: string[]}>} Canonical
 *     locations sorted by count descending, ties broken alphabetically.
 */
export function locationCounts(rows, options) {
  const category = options && options.category;
  const groups = new Map();
  rows.forEach((row) => {
    if (category && toText(row && row.reason_category) !== category) {
      return;
    }
    const raw = toText(row && row.location);
    if (raw === '') {
      return;
    }
    const location = canonicalLocation(raw);
    if (!groups.has(location)) {
      groups.set(location, { count: 0, variants: [] });
    }
    const group = groups.get(location);
    group.count += 1;
    if (!group.variants.includes(raw)) {
      group.variants.push(raw);
    }
  });
  return Array.from(groups.entries())
    .map(([location, group]) => ({ location, count: group.count, variants: group.variants }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location));
}

/**
 * How much of one `reason_category` names a location at all.
 * @param {Array<!Object>} rows Personnel Data records.
 * @param {string} category The `reason_category` to restrict to.
 * @returns {{total: number, withLocation: number, share: number}} Row counts, and
 *     withLocation as a 0..1 share of total; 0 when total is 0.
 */
export function locationCoverage(rows, category) {
  const filtered = rows.filter((row) => toText(row && row.reason_category) === category);
  const total = filtered.length;
  const withLocation = filtered.filter((row) => toText(row && row.location) !== '').length;
  return { total, withLocation, share: total === 0 ? 0 : withLocation / total };
}
