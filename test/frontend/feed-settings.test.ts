/** The dashboard reply mapped into the dataset the pages read; its settings become the active settings. */

import { afterEach, describe, expect, test } from 'bun:test';
import { datasetFromReply } from '../../frontend/src/data/feed.ts';
import { DEFAULTS } from '../../shared/settings/defaults.ts';
import { resetActiveSettings, settingOf } from '../../frontend/src/model/activeSettings.ts';
import { defaultSettings } from '../../shared/settings/resolve.ts';
import type { SettingsValues } from '../../shared/settings/defaults.ts';

/** A minimal reply with no rows and the given settings values (or none). */
function reply(values: SettingsValues | null) {
  return {
    ok: true,
    generatedAt: '2026-09-24T00:00:00.000Z',
    data: {},
    ...(values ? { settings: { values, meta: {} as never } } : {}),
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
    const data = datasetFromReply(reply(values));
    expect(data.holidays).toEqual([{ date: '2026-08-09', name: 'National Day' }]);
    expect(data.rotations).toEqual([{ name: 'Rot 1', start: '2026-07-01', end: '2026-09-30' }]);
    expect(data.notes['Public Holidays']).toBeUndefined();
  });

  test('an empty calendar is noted, not an error', () => {
    const data = datasetFromReply(reply(defaultSettings()));
    expect(data.holidays).toEqual([]);
    expect(data.notes['Public Holidays']).toContain('Settings');
  });

  test('a reply without settings reads as the defaults', () => {
    const data = datasetFromReply(reply(null));
    expect(data.settings).toEqual(DEFAULTS);
  });

  test('the reply\'s settings become the active settings', () => {
    const values = defaultSettings();
    values.thresholds = { longMcDays: 21, leaderboardSize: 5 };
    datasetFromReply(reply(values));
    expect(settingOf('thresholds').leaderboardSize).toBe(5);
  });
});
