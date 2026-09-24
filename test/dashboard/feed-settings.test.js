/**
 * The dashboard reply's settings, mapped into the dataset the pages read: holidays and
 * rotations keep the record shape the model has always read, now sourced from the calendar
 * section, and the settings become the active settings.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { datasetFromReply } from '../../src/data/feed.js';
import { DEFAULTS } from '../../src/model/settings/defaults.js';
import { resetActiveSettings, settingOf } from '../../src/model/settings/active.js';
import { defaultSettings } from '../../src/model/settings/resolve.js';
import { TABS, STRENGTH_HEADERS, PERSONNEL_HEADERS, ROSTER_HEADERS } from '../../src/data/tabs.js';

/**
 * A minimal reply with the required tabs empty and the given settings.
 * @param {?Object} settings The `settings` field, or null to leave it out.
 * @returns {!Object} The reply body.
 */
function reply(settings) {
  return {
    ok: true,
    generatedAt: '2026-09-24T00:00:00.000Z',
    tabs: { [TABS.STRENGTH]: [STRENGTH_HEADERS], [TABS.PERSONNEL]: [PERSONNEL_HEADERS], [TABS.ROSTER]: [ROSTER_HEADERS] },
    ...(settings ? { settings } : {}),
  };
}

describe('datasetFromReply', () => {
  afterEach(() => resetActiveSettings());

  test('holidays and rotations come from the calendar section, in the model\'s record shape', () => {
    const values = defaultSettings();
    values.calendar = {
      holidays: [{ date: '2026-08-09', name: 'National Day' }],
      rotations: [{ name: 'Rot 1', start: '2026-07-01', end: '2026-09-30' }],
    };
    const data = datasetFromReply(reply({ values, meta: {} }));
    expect(data.holidays).toEqual([{ date: '2026-08-09', name: 'National Day' }]);
    expect(data.rotations).toEqual([{ name: 'Rot 1', start_date: '2026-07-01', end_date: '2026-09-30' }]);
    expect(data.available.holidays).toBe(true);
  });

  test('an empty calendar is noted, not an error', () => {
    const data = datasetFromReply(reply({ values: defaultSettings(), meta: {} }));
    expect(data.holidays).toEqual([]);
    expect(data.available.holidays).toBe(false);
    expect(data.notes['Public Holidays']).toContain('Settings');
  });

  test('a reply without settings reads as the defaults', () => {
    const data = datasetFromReply(reply(null));
    expect(data.settings).toEqual(DEFAULTS);
  });

  test('the reply\'s settings become the active settings', () => {
    const values = defaultSettings();
    values.thresholds = { longMcDays: 21, leaderboardSize: 5 };
    datasetFromReply(reply({ values, meta: {} }));
    expect(settingOf('thresholds').leaderboardSize).toBe(5);
  });
});
