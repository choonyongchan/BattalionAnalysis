/**
 * Resolves a soldier to a stable key across parade states and FormSG submissions.
 *
 * `four_d` is the real identifier, but it is blank on 14% of personnel rows — mostly
 * commanders, who are named without one. Dropping those rows would understate exactly the
 * people a commander is most likely to look up, so a normalised name is the fallback:
 * weaker, since two soldiers can share a name, but far better than a gap.
 *
 * Every function here is pure.
 */

import { toText } from './values.js';

/**
 * Normalises a person's name for use as an identity key.
 *
 * Collapses case, punctuation and runs of whitespace, so "NG JUN WEI, CALEB" and
 * "Ng Jun Wei Caleb" resolve to the same soldier.
 * @param {*} name Raw name cell.
 * @returns {string} A normalised key, or '' when the name is blank.
 */
export function normaliseName(name) {
  return toText(name)
    .toUpperCase()
    .replace(/[.,'"()\/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Builds the identity key for a row carrying `four_d` and `name`.
 * @param {!Object} row A record with `four_d` and `name` fields.
 * @returns {{key: string, source: string}} The key, and which field produced it.
 */
export function identityOf(row) {
  const fourD = toText(row.four_d).toUpperCase();
  if (fourD !== '') {
    return { key: '4D:' + fourD, source: 'four_d' };
  }
  const name = normaliseName(row.name);
  if (name !== '') {
    return { key: 'NAME:' + name, source: 'name' };
  }
  return { key: '', source: 'none' };
}

/**
 * Builds the same key from a 4D and a name held separately.
 *
 * FormSG stores the two in different questions, so it cannot use `identityOf` directly,
 * but it must produce a key that matches one.
 * @param {*} fourD The 4D number.
 * @param {*} name The soldier's name.
 * @returns {string} The identity key, or ''.
 */
export function identityKey(fourD, name) {
  const digits = toText(fourD).toUpperCase();
  if (digits !== '') {
    return '4D:' + digits;
  }
  const normalised = normaliseName(name);
  return normalised === '' ? '' : 'NAME:' + normalised;
}
