/**
 * Reconciles the two report-sick sources on soldier identity, by company.
 *
 * "Reporting sick" on the parade state and "reported sick" on the FormSG form are filled
 * in by different people and rarely cross-checked. This module lines them up per company:
 * how many distinct soldiers each source has, how many are the same soldier, and the
 * names that appear in one source but not the other.
 *
 * Matching is two-tier. First the shared identity key — the 4D number where both sides
 * have it, otherwise the normalised name — which is exact. Then, for whoever is left, a
 * token-set name match that tolerates a nickname present on one side only, a different
 * token order, and a rank left in the name field.
 *
 * This is a flagging aid, not an authoritative join. A surname plus a single given name
 * can collide between two soldiers, and true homonyms are indistinguishable here. Every
 * function is pure.
 */

import { normaliseName } from './identity.js';
import { COMPANIES } from './domain.js';

/** Rank tokens that may survive into a name field and must not drive a match. */
const RANKS = new Set([
  'REC', 'PTE', 'LCP', 'LCPL', 'CPL', '1PTE', '2PTE', '3SG', '2SG', '1SG', 'SSG', 'MSG',
  '1WO', '2WO', '3WO', 'MWO', 'CWO', 'SWO', 'OCT', 'OFC', '2LT', 'LTA', 'CPT', 'MAJ',
  'LTC', 'SLTC', 'COL', 'BG', 'ME1', 'ME2', 'ME3', 'ME4', 'ME5', 'DR',
]);

/** Name connectors that carry no identifying weight on their own. */
const CONNECTORS = new Set(['BIN', 'BINTE', 'BTE']);

/** The bucket for a FormSG submission whose unit answer names no known company. */
const UNASSIGNED = 'Unassigned';

/**
 * Splits a name into comparable tokens.
 *
 * Drops one-letter tokens (initials, and the `s o` / `d o` left by `s/o` and `d/o`),
 * rank tokens, and name connectors, so what remains is the identifying words.
 * @param {*} name Raw name.
 * @returns {Array<string>} Upper-case tokens, in their original order.
 */
export function nameTokens(name) {
  return normaliseName(name)
    .split(' ')
    .filter((token) => token.length > 1 && !RANKS.has(token) && !CONNECTORS.has(token));
}

/**
 * Whether two names plausibly belong to the same soldier.
 *
 * True when every token of the shorter name (at least two of them) also appears in the
 * longer name — which covers a nickname on one side only and any token order — or when
 * the two token sets overlap by at least 60%.
 * @param {*} a One name.
 * @param {*} b The other name.
 * @returns {boolean} Whether they match.
 */
export function namesMatch(a, b) {
  const setA = new Set(nameTokens(a));
  const setB = new Set(nameTokens(b));
  if (setA.size === 0 || setB.size === 0) {
    return false;
  }
  let inter = 0;
  setA.forEach((token) => {
    if (setB.has(token)) {
      inter += 1;
    }
  });
  const smaller = Math.min(setA.size, setB.size);
  if (smaller >= 2 && inter === smaller) {
    return true;
  }
  return inter / (setA.size + setB.size - inter) >= 0.6;
}

/**
 * A person's display name, falling back to the 4D number and then the identity key.
 * @param {!Object} record An episode or a submission.
 * @returns {string} The best available label.
 */
function labelOf_(record) {
  const name = String(record.name == null ? '' : record.name).trim();
  if (name !== '') {
    return name;
  }
  const fourD = String(record.fourD == null ? '' : record.fourD).trim();
  return fourD !== '' ? '4D:' + fourD : record.key || '';
}

/**
 * Reduces records to one entry per distinct soldier, keyed by identity.
 * @param {Array<!Object>} records Episodes or submissions for one company.
 * @returns {Array<{key: string, name: string}>} Distinct persons, first spelling kept.
 */
function distinctPersons_(records) {
  const byKey = new Map();
  const anonymous = [];
  records.forEach((record) => {
    const person = { key: record.key || '', name: labelOf_(record) };
    if (person.key === '') {
      anonymous.push(person);
    } else if (!byKey.has(person.key)) {
      byKey.set(person.key, person);
    }
  });
  return [...byKey.values(), ...anonymous];
}

/**
 * Buckets records by company, using a fixed fallback label for a blank company.
 * @param {Array<!Object>} records Episodes or submissions.
 * @param {string} blankLabel Bucket name for a record with no company.
 * @returns {!Map<string, Array<!Object>>} Records grouped by company.
 */
function byCompany_(records, blankLabel) {
  const groups = new Map();
  records.forEach((record) => {
    const company = String(record.company == null ? '' : record.company).trim() || blankLabel;
    if (!groups.has(company)) {
      groups.set(company, []);
    }
    groups.get(company).push(record);
  });
  return groups;
}

/**
 * Matches parade-state persons to FormSG persons within one company.
 *
 * Exact identity key first, then a greedy name match over whoever is unmatched on each
 * side — the first still-unmatched FormSG person whose name matches.
 * @param {Array<{key: string, name: string}>} parade Distinct parade-state persons.
 * @param {Array<{key: string, name: string}>} formsg Distinct FormSG persons.
 * @returns {{matched: number, paradeOnly: Array<string>, formsgOnly: Array<string>}} The tally.
 */
function matchPersons_(parade, formsg) {
  const formsgKeys = new Set(formsg.map((person) => person.key));
  const claimed = new Set();
  let matched = 0;
  const paradeOnly = [];

  parade.forEach((person) => {
    if (person.key !== '' && formsgKeys.has(person.key) && !claimed.has(person.key)) {
      claimed.add(person.key);
      matched += 1;
      return;
    }
    const hit = formsg.find(
      (other) => !claimed.has(other.key || other) && namesMatch(person.name, other.name)
    );
    if (hit) {
      claimed.add(hit.key || hit);
      matched += 1;
    } else {
      paradeOnly.push(person.name);
    }
  });

  const formsgOnly = formsg
    .filter((person) => !claimed.has(person.key || person))
    .map((person) => person.name);

  return { matched, paradeOnly, formsgOnly };
}

/**
 * Reconciles report-sick soldiers between the parade state and FormSG, by company.
 * @param {Array<!Object>} episodes Report-sick episodes (already filtered to the class).
 * @param {Array<!Object>} submissions Normalised FormSG submissions.
 * @returns {Array<{company: string, paradeCount: number, formsgCount: number, matched: number,
 *   paradeOnly: Array<string>, formsgOnly: Array<string>}>} One row per company with
 *   activity, in parade order, with `Unassigned` last.
 */
export function reconcileReportSick(episodes, submissions) {
  const paradeGroups = byCompany_(episodes, UNASSIGNED);
  const formsgGroups = byCompany_(submissions, UNASSIGNED);
  const order = [...COMPANIES, UNASSIGNED];
  const companies = [...new Set([...paradeGroups.keys(), ...formsgGroups.keys()])].sort(
    (a, b) => order.indexOf(a) - order.indexOf(b)
  );

  return companies.map((company) => {
    const parade = distinctPersons_(paradeGroups.get(company) || []);
    const formsg = distinctPersons_(formsgGroups.get(company) || []);
    const { matched, paradeOnly, formsgOnly } = matchPersons_(parade, formsg);
    return {
      company,
      paradeCount: parade.length,
      formsgCount: formsg.length,
      matched,
      paradeOnly,
      formsgOnly,
    };
  });
}
