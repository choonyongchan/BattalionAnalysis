/**
 * What makes a settings value savable, and the sentence to show beside a field when it is not.
 *
 * The browser runs this before sending, so a mistake is caught while the form is open; the
 * server runs the same code before writing, so a hand-crafted request cannot store what the
 * form would refuse. Errors block a save. Warnings do not: a gap between rotations is worth
 * knowing about, but it is not wrong.
 *
 * Each error carries the path of the field it belongs to (`holidays.1.name`), so the page can
 * put it next to that field rather than in a list at the top.
 *
 * Every function here is pure.
 */

import { rotationIssues } from '../rotations.js';

/** @type {!RegExp} An ISO `yyyy-MM-dd` date. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @type {!RegExp} An inline image the browser can show as a logo. */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/**
 * Longest logo data URL accepted: about 200 KB of image once base64's 4/3 overhead is removed.
 * The logo travels with every dashboard read, so it is kept small.
 * @type {number}
 */
export const MAX_LOGO_CHARS = 280000;

/**
 * Whether a value is a real calendar date written as ISO `yyyy-MM-dd`.
 * @param {*} value The candidate.
 * @returns {boolean} False for `2026-02-30` as well as for non-strings.
 */
function isIsoDate_(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * A text field, trimmed; anything that is not a string reads as blank.
 * @param {*} value The raw field.
 * @returns {string} The trimmed text.
 */
function text_(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Records an error unless the text is 1 to `max` characters long.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {string} path The field's path.
 * @param {string} value The trimmed text.
 * @param {number} max Longest allowed length.
 * @param {string} message What to say when it is out of bounds.
 * @returns {void}
 */
function requireText_(errors, path, value, max, message) {
  if (value === '' || value.length > max) {
    errors.push({ path, message });
  }
}

/**
 * Records an error unless the value is a whole number within bounds.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {string} path The field's path.
 * @param {*} value The raw field.
 * @param {number} min Smallest allowed.
 * @param {number} max Largest allowed.
 * @returns {void}
 */
function requireInt_(errors, path, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push({ path, message: 'Enter a whole number from ' + min + ' to ' + max + '.' });
  }
}

/**
 * A field that must be a list; records an error and reads as empty when it is not.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {string} path The field's path.
 * @param {*} value The raw field.
 * @returns {!Array<*>} The list, or [].
 */
function listOf_(errors, path, value) {
  if (!Array.isArray(value)) {
    errors.push({ path, message: 'Must be a list.' });
    return [];
  }
  return value;
}

/**
 * The positions of every repeat of an earlier key.
 * @param {!Array<string>} keys One key per list item.
 * @returns {!Array<number>} Indexes of the second and later occurrences.
 */
function repeats_(keys) {
  const seen = new Set();
  const repeated = [];
  keys.forEach((key, index) => {
    if (seen.has(key)) {
      repeated.push(index);
    }
    seen.add(key);
  });
  return repeated;
}

/**
 * Validates the `unit` section.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @returns {!Object} The cleaned section.
 */
function unit_(value, errors) {
  const name = text_(value.name);
  const pageTitle = text_(value.pageTitle);
  const logo = typeof value.logo === 'string' ? value.logo.trim() : '';
  requireText_(errors, 'name', name, 40, 'Enter a unit name of 1 to 40 characters.');
  requireText_(errors, 'pageTitle', pageTitle, 80, 'Enter a page title of 1 to 80 characters.');
  if (logo !== '' && (!LOGO_DATA_URL.test(logo) || logo.length > MAX_LOGO_CHARS)) {
    errors.push({ path: 'logo', message: 'Upload a PNG, JPEG, WebP or SVG image of 200 KB or less.' });
  }
  return { name, pageTitle, logo };
}

/**
 * Validates the `calendar` section: holidays by date, rotations by start.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {!Array<!Object>} warnings Collects warnings.
 * @returns {!Object} The cleaned section, both lists sorted.
 */
function calendar_(value, errors, warnings) {
  const holidays = listOf_(errors, 'holidays', value.holidays).map((holiday, index) => {
    const date = text_(holiday && holiday.date);
    const name = text_(holiday && holiday.name);
    if (!isIsoDate_(date)) {
      errors.push({ path: 'holidays.' + index + '.date', message: 'Enter a date.' });
    }
    requireText_(errors, 'holidays.' + index + '.name', name, 80, 'Enter the holiday\'s name.');
    return { date, name };
  });
  repeats_(holidays.map((holiday) => holiday.date)).forEach((index) => {
    errors.push({ path: 'holidays.' + index + '.date', message: 'This date is listed twice.' });
  });

  const rotations = listOf_(errors, 'rotations', value.rotations).map((rotation, index) => {
    const name = text_(rotation && rotation.name);
    const start = text_(rotation && rotation.start);
    const end = text_(rotation && rotation.end);
    requireText_(errors, 'rotations.' + index + '.name', name, 40, 'Enter the rotation\'s name.');
    if (!isIsoDate_(start)) {
      errors.push({ path: 'rotations.' + index + '.start', message: 'Enter a date.' });
    }
    if (!isIsoDate_(end)) {
      errors.push({ path: 'rotations.' + index + '.end', message: 'Enter a date.' });
    } else if (isIsoDate_(start) && start > end) {
      errors.push({ path: 'rotations.' + index + '.end', message: 'Ends before it starts.' });
    }
    return { name, start, end };
  });
  repeats_(rotations.map((rotation) => rotation.name + '|' + rotation.start)).forEach((index) => {
    errors.push({ path: 'rotations.' + index + '.name', message: 'Another rotation has this name and start date.' });
  });

  if (errors.length === 0) {
    rotationIssues(rotations).forEach((issue) => warnings.push({ path: 'rotations', message: issue.message }));
  }
  holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  rotations.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { holidays, rotations };
}

/**
 * Validates the `thresholds` section.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @returns {!Object} The cleaned section.
 */
function thresholds_(value, errors) {
  requireInt_(errors, 'longMcDays', value.longMcDays, 1, 365);
  requireInt_(errors, 'leaderboardSize', value.leaderboardSize, 1, 100);
  return { longMcDays: value.longMcDays, leaderboardSize: value.leaderboardSize };
}

/**
 * Validates the `session` section.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @returns {!Object} The cleaned section.
 */
function session_(value, errors) {
  requireInt_(errors, 'ttlHours', value.ttlHours, 1, 72);
  requireInt_(errors, 'refreshSeconds', value.refreshSeconds, 15, 3600);
  return { ttlHours: value.ttlHours, refreshSeconds: value.refreshSeconds };
}

/** @type {!Object<string, function(!Object, !Array<!Object>, !Array<!Object>): !Object>} */
const VALIDATORS = { unit: unit_, calendar: calendar_, thresholds: thresholds_, session: session_ };

/**
 * Validates and cleans one section's value.
 * @param {string} section The section name.
 * @param {*} value The value to check, from the form or a stored row.
 * @returns {{value: ?Object, errors: !Array<{path: string, message: string}>,
 *     warnings: !Array<{path: string, message: string}>}} The cleaned value (only known keys,
 *     text trimmed, lists sorted) when there are no errors, else null.
 */
export function validateSection(section, value) {
  const validator = VALIDATORS[section];
  if (!validator) {
    return { value: null, errors: [{ path: '', message: 'Unknown settings section "' + section + '".' }], warnings: [] };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value: null, errors: [{ path: '', message: 'Must be an object.' }], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const cleaned = validator(value, errors, warnings);
  return { value: errors.length === 0 ? cleaned : null, errors, warnings };
}

/**
 * The first error message for one field, for the form to show beside it.
 * @param {!Array<{path: string, message: string}>} errors Errors from `validateSection`.
 * @param {string} path The field's path.
 * @returns {string} The message, or '' when the field has none.
 */
export function errorAt(errors, path) {
  const found = (errors || []).find((error) => error.path === path);
  return found ? found.message : '';
}
