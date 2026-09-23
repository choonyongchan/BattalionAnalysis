/**
 * Resolves a soldier to a stable key across parade states and FormSG submissions.
 *
 * `four_d` is the real identifier, but it is blank on 14% of personnel rows — mostly
 * commanders, who are named without one. Dropping those rows would understate exactly the
 * people a commander is most likely to look up, so a normalised name is the fallback:
 * weaker, since two soldiers can share a name, but far better than a gap. A placeholder
 * typed where a 4D should be ("NIL", "Rec") is treated as blank: in FormSG, "NIL" alone
 * stood for thirty different people, and keying on it made them one.
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
 * Placeholders soldiers type when they have no 4D number. Mirrors `FOUR_D_PLACEHOLDERS` in
 * `lib/domain.ts`; `test/lib/domain.test.ts` pins the two together.
 * @type {!Set<string>}
 */
const FOUR_D_PLACEHOLDERS = new Set(['NIL', 'NA', 'N/A', 'NONE', '-', 'REC']);

/**
 * Normalises a 4D number, reading a blank or a placeholder as no 4D at all.
 * @param {*} fourD Raw 4D cell, e.g. " 2208 ", "Nil".
 * @returns {string} The trimmed upper-case 4D, or '' when blank or a placeholder.
 */
export function normaliseFourD(fourD) {
  const value = toText(fourD).toUpperCase();
  return FOUR_D_PLACEHOLDERS.has(value) ? '' : value;
}

/**
 * Builds the identity key from a 4D and a name held separately.
 *
 * The one place a key is built. FormSG stores the 4D and the name in different questions
 * and so cannot pass a row to `identityOf`, but the key it gets has to be the same key the
 * personnel row for that soldier gets — the two sources are joined on it. Written twice,
 * the copies drifted: this one read the 4D raw, so a soldier who typed "NIL" keyed as
 * `4D:NIL` from FormSG and on his name from the parade state, which is both a soldier
 * split in two and thirty soldiers merged into one.
 * @param {*} fourD The 4D number.
 * @param {*} name The soldier's name.
 * @returns {string} The identity key, or '' when neither field names anyone.
 */
export function identityKey(fourD, name) {
  const digits = normaliseFourD(fourD);
  if (digits !== '') {
    return '4D:' + digits;
  }
  const normalised = normaliseName(name);
  return normalised === '' ? '' : 'NAME:' + normalised;
}

/**
 * Builds the identity key for a row carrying `four_d` and `name`, and names its source.
 * @param {!Object} row A record with `four_d` and `name` fields.
 * @returns {{key: string, source: string}} The key, and which field produced it.
 */
export function identityOf(row) {
  const key = identityKey(row.four_d, row.name);
  if (key === '') {
    return { key, source: 'none' };
  }
  return { key, source: key.startsWith('4D:') ? 'four_d' : 'name' };
}
