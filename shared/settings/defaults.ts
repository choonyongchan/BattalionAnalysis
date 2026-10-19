/** Settings-page sections and their defaults; a section with no stored row is its default. */

import type { Rotation } from '../rotations.ts';

/** A public holiday on the Settings calendar. */
export interface Holiday {
  date: string;
  name: string;
}

/** Every section's value type. */
export interface SettingsValues {
  unit: { name: string; pageTitle: string; logo: string };
  calendar: { holidays: Holiday[]; rotations: Rotation[] };
  thresholds: { longMcDays: number; leaderboardSize: number };
  session: { ttlHours: number; refreshSeconds: number };
}

export type SectionName = keyof SettingsValues;

/** Every section in page order; Basic is set up per batch, Advanced changes how the system runs. */
export const SECTIONS: { name: SectionName; tier: 'basic' | 'advanced'; label: string }[] = [
  { name: 'unit', tier: 'basic', label: 'Unit' },
  { name: 'calendar', tier: 'basic', label: 'Calendar' },
  { name: 'thresholds', tier: 'basic', label: 'Thresholds' },
  { name: 'session', tier: 'advanced', label: 'Session' },
];

/** Each section's value when nobody has saved one. */
export const DEFAULTS: SettingsValues = {
  unit: { name: '40 SAR', pageTitle: '40 SAR Personnel', logo: '' },
  calendar: { holidays: [], rotations: [] },
  thresholds: { longMcDays: 14, leaderboardSize: 10 },
  session: { ttlHours: 12, refreshSeconds: 60 },
};

/** Whether a value names a known section. */
export function isSection(name: unknown): name is SectionName {
  return SECTIONS.some((section) => section.name === name);
}

/** A deep copy of a section's default. */
export function defaultOf<S extends SectionName>(section: S): SettingsValues[S] {
  return structuredClone(DEFAULTS[section]);
}
