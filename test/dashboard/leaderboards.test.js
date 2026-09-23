/**
 * Tests for the leaderboards and unit rankings.
 *
 * Unit rankings count episodes and the distinct soldiers behind them.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS } from '../../src/data/tabs.js';
import { buildEpisodes } from '../../src/model/episodes.js';
import { DUTY_CLASS } from '../../src/model/classify.js';
import {
  rankUnits,
  topByCount,
  topByDays,
  topByStatusCount,
} from '../../src/model/leaderboards.js';

/**
 * Builds Personnel Data records from column-keyed row specs.
 * @param {Array<!Object>} specs Partial records; unlisted headers read as ''.
 * @returns {Array<!Object>} Normalised records.
 */
function personnelRows(specs) {
  const values = [
    PERSONNEL_HEADERS.slice(),
    ...specs.map((spec) => PERSONNEL_HEADERS.map((header) => (header in spec ? spec[header] : ''))),
  ];
  return toRecords(values, PERSONNEL_HEADERS, 'Personnel Data');
}

describe('topByCount', () => {
  test('ranks by episode count, ties broken by name', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Report Sick', start_date: '2026-07-20', end_date: '2026-07-20' },
      { date: '2026-07-21', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Report Sick', start_date: '2026-07-21', end_date: '2026-07-21' },
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1102', name: 'ADA', reason_category: 'Report Sick', start_date: '2026-07-20', end_date: '2026-07-20' },
      { date: '2026-07-21', session: 'FPS', company: 'Archer', four_d: '1103', name: 'BEN', reason_category: 'Report Sick', start_date: '2026-07-21', end_date: '2026-07-21' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByCount(episodes, DUTY_CLASS.REPORT_SICK, 10);
    expect(top[0].name).toBe('ZED');
    expect(top[0].count).toBe(2);
    // ADA and BEN tie at 1 episode; alphabetical break puts ADA first.
    expect(top[1].name).toBe('ADA');
    expect(top[2].name).toBe('BEN');
  });

  test('a soldier with no 4D still ranks, keyed by name', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', name: '3SG COMMANDER', reason_category: 'Report Sick', start_date: '2026-07-20', end_date: '2026-07-20' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByCount(episodes, DUTY_CLASS.REPORT_SICK, 10);
    expect(top).toHaveLength(1);
    expect(top[0].name).toBe('3SG COMMANDER');
  });

  test('fills in the platoon from the 4D when the row leaves it blank', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Hercules', four_d: '3210', name: 'TAN', reason_category: 'Report Sick', start_date: '2026-07-20', end_date: '2026-07-20' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByCount(episodes, DUTY_CLASS.REPORT_SICK, 10);
    expect(top[0].platoon).toBe('3');
    expect(top[0].platoonInferred).toBe(true);
  });
});

describe('topByDays', () => {
  test('sums days only over episodes that state a duration, and ranks on the total', () => {
    const rows = personnelRows([
      // Stated 6-day MC.
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Att C', start_date: '2026-07-20', end_date: '2026-07-25', num_days: 6 },
      // A second MC with no stated days and no date span — falls back to 1 observed day.
      { date: '2026-08-01', session: 'FPS', company: 'Archer', four_d: '1102', name: 'ADA', reason_category: 'Att C' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByDays(episodes, DUTY_CLASS.ATT_C, 10);
    const zed = top.find((entry) => entry.name === 'ZED');
    expect(zed.count).toBe(1);
    expect(zed.days).toBe(6);
    expect(zed.meanDays).toBe(6);
    expect(top[0].name).toBe('ZED');
  });
});

describe('topByStatusCount', () => {
  test('splits temporary and permanent, and the two sum to the total', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Excuse RMJ', start_date: '2026-07-20', end_date: '2026-07-27', num_days: 7 },
      { date: '2026-08-15', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Perm Excuse Grenade & Pyro' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByStatusCount(episodes, 10);
    expect(top[0].temporary).toBe(1);
    expect(top[0].permanent).toBe(1);
    expect(top[0].count).toBe(top[0].temporary + top[0].permanent);
  });

  test('permanence is read from the reason text, since the 999 sentinel never appears', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Permanent Excuse Flags', start_date: '', end_date: '', num_days: '' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByStatusCount(episodes, 10);
    expect(top[0].permanent).toBe(1);
    expect(top[0].temporary).toBe(0);
  });
});

describe('rankUnits', () => {
  // Two episodes for 1101 (separate days), one for 1102, all Att C in Big 1; one in Small 1.
  const episodes = buildEpisodes(
    personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Big', platoon: '1', four_d: '1101', reason_category: 'Att C' },
      { date: '2026-07-24', session: 'FPS', company: 'Big', platoon: '1', four_d: '1101', reason_category: 'Att C' },
      { date: '2026-07-20', session: 'FPS', company: 'Big', platoon: '1', four_d: '1102', reason_category: 'Att C' },
      { date: '2026-07-20', session: 'FPS', company: 'Small', platoon: '1', four_d: '1201', reason_category: 'Att C' },
    ])
  );

  test('ranks companies by episode count and counts each soldier once', () => {
    const ranked = rankUnits(episodes, DUTY_CLASS.ATT_C, 'company');
    expect(ranked.map((row) => [row.company, row.count, row.soldiers])).toEqual([
      ['Big', 3, 2],
      ['Small', 1, 1],
    ]);
  });

  test('splits by platoon at the platoon level', () => {
    const ranked = rankUnits(episodes, DUTY_CLASS.ATT_C, 'platoon');
    expect(ranked[0]).toMatchObject({ company: 'Big', platoon: '1', count: 3, soldiers: 2 });
  });
});
