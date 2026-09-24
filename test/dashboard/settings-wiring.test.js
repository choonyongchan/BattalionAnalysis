/**
 * Model code that reads the active settings: a changed setting changes the answer, and the
 * defaults reproduce the old hardcoded behaviour.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { topByCount } from '../../src/model/leaderboards.js';
import { orbatTree } from '../../src/model/orbat.js';
import { resetActiveSettings, setActiveSettings } from '../../src/model/settings/active.js';
import { defaultSettings } from '../../src/model/settings/resolve.js';

/**
 * Makes `count` single-day Att C episodes, one soldier each.
 * @param {number} count How many.
 * @returns {!Array<!Object>} Episodes in the shape `buildEpisodes` returns.
 */
function episodes(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: 'S' + i,
    name: 'SOLDIER ' + i,
    rank: 'PTE',
    company: 'Archer',
    platoon: '1',
    dutyClass: 'Att C',
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    reasons: [],
  }));
}

afterEach(() => resetActiveSettings());

describe('leaderboard size', () => {
  test('defaults to 10, and follows the Thresholds setting', () => {
    expect(topByCount(episodes(15), 'Att C')).toHaveLength(10);
    const values = defaultSettings();
    values.thresholds = { longMcDays: 14, leaderboardSize: 3 };
    setActiveSettings(values);
    expect(topByCount(episodes(15), 'Att C')).toHaveLength(3);
  });

  test('an explicit limit still wins', () => {
    expect(topByCount(episodes(15), 'Att C', 5)).toHaveLength(5);
  });
});

describe('unit name', () => {
  test('names the battalion root of the duty tree', () => {
    expect(orbatTree([], '2026-09-01').name).toBe('40 SAR');
    const values = defaultSettings();
    values.unit = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };
    setActiveSettings(values);
    expect(orbatTree([], '2026-09-01').name).toBe('41 SAR');
  });
});
