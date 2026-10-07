/**
 * Stored settings rows laid over the defaults: the settings in force.
 *
 * A section with no row is its default. A row that no longer validates, because someone
 * edited it in SQL or an older build wrote a shape this one refuses, is also its default,
 * and is flagged `invalid` so the Settings page can say so. A bad row must not take the
 * dashboard down with it.
 *
 * Every function here is pure.
 */

import { SECTIONS, defaultOf } from './defaults.js';
import { validateSection } from './validate.js';

/**
 * Resolves every section from the stored rows.
 * @param {Array<{section: string, value: *, version: number}>} rows The `settings` table.
 * @returns {{values: !Object<string, !Object>, meta: !Object<string, {version: number,
 *     isDefault: boolean, invalid: boolean}>}} The value in force per section, and per
 *     section the stored version (0 when no row), whether it is the default, and whether a
 *     stored row was refused.
 */
export function resolveSettings(rows) {
  const bySection = new Map((rows || []).map((row) => [row.section, row]));
  const values = {};
  const meta = {};
  SECTIONS.forEach(({ name }) => {
    const row = bySection.get(name);
    if (!row) {
      values[name] = defaultOf(name);
      meta[name] = { version: 0, isDefault: true, invalid: false };
      return;
    }
    const checked = validateSection(name, row.value);
    const invalid = checked.errors.length > 0;
    values[name] = invalid ? defaultOf(name) : checked.value;
    meta[name] = { version: row.version, isDefault: false, invalid };
  });
  return { values, meta };
}

/**
 * Every section at its default.
 * @returns {!Object<string, !Object>} Section name to default value.
 */
export function defaultSettings() {
  return resolveSettings([]).values;
}
