/** Stored settings rows laid over the defaults; an invalid row falls back to its default and is flagged. */

import { SECTIONS, defaultOf, type SectionName, type SettingsValues } from './defaults.ts';
import { validateSection } from './validate.ts';

/** Per section: stored version (0 when none), whether it is the default, whether a stored row was refused. */
export interface SectionMeta {
  version: number;
  isDefault: boolean;
  invalid: boolean;
}

/** The settings in force and their metadata. */
export interface ResolvedSettings {
  values: SettingsValues;
  meta: Record<SectionName, SectionMeta>;
}

/** Resolves every section from the `settings` table rows. */
export function resolveSettings(rows: { section: string; value: unknown; version: number }[]): ResolvedSettings {
  const bySection = new Map(rows.map((row) => [row.section, row]));
  const values: Record<string, unknown> = {};
  const meta: Record<string, SectionMeta> = {};
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
  return { values: values as unknown as SettingsValues, meta: meta as Record<SectionName, SectionMeta> };
}

/** Every section at its default. */
export function defaultSettings(): SettingsValues {
  return resolveSettings([]).values;
}
