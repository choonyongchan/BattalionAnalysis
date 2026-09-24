/**
 * The settings the dashboard is running with, for model code that has no settings argument.
 *
 * Settings arrive with every dashboard read (`data/feed.js` sets them here). Threading a
 * `settings` parameter through every model function and every page that calls one would touch
 * dozens of signatures for no gain in a browser that runs one dashboard at a time. So model
 * code asks `settingOf(section)`, and gets the default until the first read lands.
 *
 * Server code must never use this: requests run concurrently there, so the server passes
 * settings explicitly (`lib/settings.ts`). Tests that set it reset it afterwards.
 */

import { defaultSettings } from './resolve.js';

/** @type {!Object<string, !Object>} Every section at its default, computed once. */
const DEFAULTS_IN_FORCE = defaultSettings();

/** @type {?Object<string, !Object>} The settings from the latest dashboard read, if any. */
let active = null;

/**
 * Replaces the active settings.
 * @param {?Object<string, !Object>} values Resolved values per section, or null for defaults.
 * @returns {void}
 */
export function setActiveSettings(values) {
  active = values || null;
}

/**
 * Returns to the defaults.
 * @returns {void}
 */
export function resetActiveSettings() {
  active = null;
}

/**
 * One section of the active settings.
 * @param {string} section A section name.
 * @returns {!Object} The section in force; callers must not change it.
 */
export function settingOf(section) {
  return (active && active[section]) || DEFAULTS_IN_FORCE[section];
}
