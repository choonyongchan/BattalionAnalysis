/**
 * Settings validation: what a person can save, and the sentence they read when they cannot.
 *
 * Every default must validate clean, or an untouched deployment would refuse its own settings.
 * The rest pins one refusal per rule, by the field path the Settings page shows it beside.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULTS, SECTIONS, defaultOf, isSection } from '../../src/model/settings/defaults.js';
import { MAX_LOGO_CHARS, errorAt, validateSection } from '../../src/model/settings/validate.js';

/**
 * Validates a section built from its defaults with some fields replaced.
 * @param {string} section The section.
 * @param {!Object} patch Fields to replace.
 * @returns {!Object} The validation result.
 */
function withPatch(section, patch) {
  return validateSection(section, { ...defaultOf(section), ...patch });
}

describe('defaults', () => {
  test('every section has a default, and every default validates clean', () => {
    for (const { name } of SECTIONS) {
      const result = validateSection(name, defaultOf(name));
      expect(result.errors).toEqual([]);
      expect(result.value).toEqual(DEFAULTS[name]);
    }
  });

  test('the defaults are today\'s hardcoded values', () => {
    expect(DEFAULTS.unit).toEqual({ name: '40 SAR', pageTitle: '40 SAR Personnel', logo: '' });
    expect(DEFAULTS.thresholds).toEqual({ longMcDays: 14, leaderboardSize: 10 });
    expect(DEFAULTS.session).toEqual({ ttlHours: 12, refreshSeconds: 60 });
    expect(DEFAULTS.calendar).toEqual({ holidays: [], rotations: [] });
  });

  test('defaultOf returns a copy, so editing it cannot change the defaults', () => {
    const copy = defaultOf('calendar');
    copy.holidays.push({ date: '2026-08-09', name: 'National Day' });
    expect(DEFAULTS.calendar.holidays).toEqual([]);
  });

  test('Basic holds unit, calendar and thresholds; Advanced holds session', () => {
    const tierOf = Object.fromEntries(SECTIONS.map((s) => [s.name, s.tier]));
    expect(tierOf).toEqual({ unit: 'basic', calendar: 'basic', thresholds: 'basic', session: 'advanced' });
    expect(isSection('unit')).toBe(true);
    expect(isSection('parser')).toBe(false);
  });
});

describe('validateSection', () => {
  test('an unknown section, or a value that is not an object, is refused', () => {
    expect(validateSection('nope', {}).errors[0].message).toContain('Unknown');
    expect(validateSection('unit', null).errors).toEqual([{ path: '', message: 'Must be an object.' }]);
    expect(validateSection('unit', []).errors).toEqual([{ path: '', message: 'Must be an object.' }]);
  });

  test('unit: a blank name or page title is refused; text is trimmed', () => {
    expect(errorAt(withPatch('unit', { name: '  ' }).errors, 'name')).not.toBe('');
    expect(errorAt(withPatch('unit', { pageTitle: '' }).errors, 'pageTitle')).not.toBe('');
    expect(withPatch('unit', { name: ' 41 SAR ' }).value.name).toBe('41 SAR');
  });

  test('unit: a logo must be an image data URL within the size limit', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(withPatch('unit', { logo: png }).errors).toEqual([]);
    expect(errorAt(withPatch('unit', { logo: 'https://example.com/a.png' }).errors, 'logo')).not.toBe('');
    expect(errorAt(withPatch('unit', { logo: 'data:text/html;base64,PGgxPg==' }).errors, 'logo')).not.toBe('');
    const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_CHARS);
    expect(errorAt(withPatch('unit', { logo: huge }).errors, 'logo')).not.toBe('');
  });

  test('calendar: holidays need a real date and a name, once each, and come back sorted', () => {
    const bad = validateSection('calendar', {
      holidays: [
        { date: '2026-02-30', name: 'Not a day' },
        { date: '2026-08-09', name: '' },
      ],
      rotations: [],
    });
    expect(errorAt(bad.errors, 'holidays.0.date')).not.toBe('');
    expect(errorAt(bad.errors, 'holidays.1.name')).not.toBe('');

    const twice = validateSection('calendar', {
      holidays: [
        { date: '2026-08-09', name: 'National Day' },
        { date: '2026-08-09', name: 'Again' },
      ],
      rotations: [],
    });
    expect(errorAt(twice.errors, 'holidays.1.date')).toBe('This date is listed twice.');

    const sorted = validateSection('calendar', {
      holidays: [
        { date: '2026-12-25', name: 'Christmas Day' },
        { date: '2026-01-01', name: "New Year's Day" },
      ],
      rotations: [],
    });
    expect(sorted.value.holidays.map((h) => h.date)).toEqual(['2026-01-01', '2026-12-25']);
  });

  test('calendar: a rotation that ends before it starts is an error; gaps and overlaps only warn', () => {
    const reversed = validateSection('calendar', {
      holidays: [],
      rotations: [{ name: 'Rot 1', start: '2026-09-30', end: '2026-07-01' }],
    });
    expect(errorAt(reversed.errors, 'rotations.0.end')).toBe('Ends before it starts.');

    const overlapping = validateSection('calendar', {
      holidays: [],
      rotations: [
        { name: 'Rot 1', start: '2026-07-01', end: '2026-08-15' },
        { name: 'Rot 2', start: '2026-08-01', end: '2026-09-30' },
      ],
    });
    expect(overlapping.errors).toEqual([]);
    expect(overlapping.warnings.map((w) => w.path)).toEqual(['rotations']);
    expect(overlapping.warnings[0].message).toContain('overlap');
  });

  test('calendar: a missing list is an error, not a silent empty list', () => {
    expect(errorAt(validateSection('calendar', { rotations: [] }).errors, 'holidays')).toBe('Must be a list.');
  });

  test('thresholds and session: whole numbers within bounds', () => {
    expect(errorAt(withPatch('thresholds', { longMcDays: 0 }).errors, 'longMcDays')).not.toBe('');
    expect(errorAt(withPatch('thresholds', { leaderboardSize: 2.5 }).errors, 'leaderboardSize')).not.toBe('');
    expect(errorAt(withPatch('thresholds', { leaderboardSize: '10' }).errors, 'leaderboardSize')).not.toBe('');
    expect(errorAt(withPatch('session', { ttlHours: 73 }).errors, 'ttlHours')).not.toBe('');
    expect(errorAt(withPatch('session', { refreshSeconds: 14 }).errors, 'refreshSeconds')).not.toBe('');
    expect(withPatch('session', { ttlHours: 72, refreshSeconds: 15 }).errors).toEqual([]);
  });

  test('unknown keys are dropped from the cleaned value', () => {
    expect(withPatch('thresholds', { surprise: 1 }).value).toEqual({ longMcDays: 14, leaderboardSize: 10 });
  });
});
