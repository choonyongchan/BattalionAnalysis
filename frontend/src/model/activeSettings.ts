/**
 * The settings the dashboard runs with, set by each dashboard read (`data/feed`).
 * Browser only: server requests run concurrently, so the server passes settings explicitly.
 */

import { defaultSettings } from '../../../shared/settings/resolve.ts';
import type { SectionName, SettingsValues } from '../../../shared/settings/defaults.ts';

const DEFAULTS_IN_FORCE = defaultSettings();

let active: SettingsValues | null = null;

/** Replaces the active settings; null returns to the defaults. */
export function setActiveSettings(values: SettingsValues | null): void {
  active = values;
}

/** Returns to the defaults. */
export function resetActiveSettings(): void {
  active = null;
}

/** One section of the settings in force; callers must not change it. */
export function settingOf<S extends SectionName>(section: S): SettingsValues[S] {
  return (active ?? DEFAULTS_IN_FORCE)[section];
}
