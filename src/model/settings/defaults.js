/**
 * The settings a person can change on the Settings page, and what each is until they do.
 *
 * One entry per section, one `settings` row per section in Neon. A section with no row is its
 * default here, which is why every default equals the value the code hardcoded before
 * settings existed: an untouched deployment behaves exactly as it always did.
 *
 * `tier` decides the tab: Basic is what a new batch or battalion sets up; Advanced changes how
 * messages and forms are read, or how the dashboard runs. Later phases add sections here.
 *
 * Shared by the browser and the server (`lib/settings.ts`), so it must stay pure.
 */

/**
 * Every section, in the order the Settings page shows them within a tab.
 * @type {!Array<{name: string, tier: string, label: string}>}
 */
export const SECTIONS = [
  { name: 'unit', tier: 'basic', label: 'Unit' },
  { name: 'calendar', tier: 'basic', label: 'Calendar' },
  { name: 'thresholds', tier: 'basic', label: 'Thresholds' },
  { name: 'session', tier: 'advanced', label: 'Session' },
];

/**
 * Each section's value when nobody has saved one.
 *
 * `longMcDays` is the shortest MC that counts as long-term (the page used to hardcode "more
 * than 13"). Holidays and rotations start empty: which days they are is the battalion's to say.
 * @type {!Object<string, !Object>}
 */
export const DEFAULTS = {
  unit: { name: '40 SAR', pageTitle: '40 SAR Personnel', logo: '' },
  calendar: { holidays: [], rotations: [] },
  thresholds: { longMcDays: 14, leaderboardSize: 10 },
  session: { ttlHours: 12, refreshSeconds: 60 },
};

/**
 * Whether a name is a known section.
 * @param {*} name A section name from a request or a stored row.
 * @returns {boolean} True for a section in `SECTIONS`.
 */
export function isSection(name) {
  return SECTIONS.some((section) => section.name === name);
}

/**
 * A section's default, as a copy the caller may change.
 * @param {string} section A section name from `SECTIONS`.
 * @returns {!Object} A deep copy of its default.
 */
export function defaultOf(section) {
  return structuredClone(DEFAULTS[section]);
}
