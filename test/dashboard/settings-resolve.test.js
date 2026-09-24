/**
 * Stored settings over the defaults: a section nobody saved is its default, and a stored
 * section that no longer validates (hand-edited in SQL, say) falls back rather than breaking
 * the dashboard.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULTS } from '../../src/model/settings/defaults.js';
import { defaultSettings, resolveSettings } from '../../src/model/settings/resolve.js';
import { resetActiveSettings, setActiveSettings, settingOf } from '../../src/model/settings/active.js';

describe('resolveSettings', () => {
  test('no rows: every section is its default, at version 0', () => {
    const { values, meta } = resolveSettings([]);
    expect(values).toEqual(DEFAULTS);
    expect(meta.unit).toEqual({ version: 0, isDefault: true, invalid: false });
  });

  test('a stored section replaces its default and carries its version', () => {
    const { values, meta } = resolveSettings([
      { section: 'unit', value: { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' }, version: 3 },
    ]);
    expect(values.unit.name).toBe('41 SAR');
    expect(meta.unit).toEqual({ version: 3, isDefault: false, invalid: false });
    expect(values.session).toEqual(DEFAULTS.session);
  });

  test('an invalid stored section falls back to its default and is flagged', () => {
    const { values, meta } = resolveSettings([{ section: 'thresholds', value: { longMcDays: 'soon' }, version: 2 }]);
    expect(values.thresholds).toEqual(DEFAULTS.thresholds);
    expect(meta.thresholds).toEqual({ version: 2, isDefault: false, invalid: true });
  });

  test('a row for a section this build does not know is ignored', () => {
    expect(Object.keys(resolveSettings([{ section: 'future', value: {}, version: 1 }]).values).sort()).toEqual(
      Object.keys(DEFAULTS).sort()
    );
  });
});

describe('active settings', () => {
  afterEach(() => resetActiveSettings());

  test('before any are set, a section reads as its default', () => {
    expect(settingOf('thresholds')).toEqual(DEFAULTS.thresholds);
  });

  test('once set, a section reads as set; reset returns to the defaults', () => {
    setActiveSettings({ ...defaultSettings(), thresholds: { longMcDays: 7, leaderboardSize: 5 } });
    expect(settingOf('thresholds').leaderboardSize).toBe(5);
    resetActiveSettings();
    expect(settingOf('thresholds').leaderboardSize).toBe(10);
  });
});
