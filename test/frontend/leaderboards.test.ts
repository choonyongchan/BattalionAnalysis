/**
 * Tests for the leaderboards and unit rankings.
 *
 * Unit rankings count episodes and the distinct soldiers behind them.
 */

import { describe, expect, test } from 'bun:test';
import type { PersonnelRow } from '../../shared/dashboard.ts';
import { episode, personnelRows } from './fixtures.ts';
import { buildEpisodes } from '../../frontend/src/model/episodes.ts';
import { DUTY_CLASS } from '../../frontend/src/model/classify.ts';
import {
  soldierLoad,
  rankUnits,
  topByCount,
  topByDays,
  topByStatusCount,
} from '../../frontend/src/model/leaderboards.ts';

describe('topByCount', () => {
  test('ranks by episode count, ties broken by name', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', fourD: '1101', name: 'ZED', reasonCategory: 'Report Sick', startDate: '2026-07-20', endDate: '2026-07-20' },
      { date: '2026-07-21', session: 'FPS', company: 'Archer', fourD: '1101', name: 'ZED', reasonCategory: 'Report Sick', startDate: '2026-07-21', endDate: '2026-07-21' },
      { date: '2026-07-20', session: 'FPS', company: 'Archer', fourD: '1102', name: 'ADA', reasonCategory: 'Report Sick', startDate: '2026-07-20', endDate: '2026-07-20' },
      { date: '2026-07-21', session: 'FPS', company: 'Archer', fourD: '1103', name: 'BEN', reasonCategory: 'Report Sick', startDate: '2026-07-21', endDate: '2026-07-21' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByCount(episodes, DUTY_CLASS.REPORT_SICK, 10);
    expect(top[0]!.name).toBe('ZED');
    expect(top[0]!.count).toBe(2);
    // ADA and BEN tie at 1 episode; alphabetical break puts ADA first.
    expect(top[1]!.name).toBe('ADA');
    expect(top[2]!.name).toBe('BEN');
  });

  test('a soldier with no 4D still ranks, keyed by name', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', name: '3SG COMMANDER', reasonCategory: 'Report Sick', startDate: '2026-07-20', endDate: '2026-07-20' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByCount(episodes, DUTY_CLASS.REPORT_SICK, 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.name).toBe('3SG COMMANDER');
  });

  test('takes the platoon from the sub-header, never from the 4D', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Hercules', platoon: 'SIG', fourD: '3210', name: 'TAN', reasonCategory: 'Report Sick', startDate: '2026-07-20', endDate: '2026-07-20' },
      { date: '2026-07-20', session: 'FPS', company: 'Cougar', fourD: '7210', name: 'LIM', reasonCategory: 'Report Sick', startDate: '2026-07-20', endDate: '2026-07-20' },
    ]);
    const top = topByCount(buildEpisodes(rows), DUTY_CLASS.REPORT_SICK, 10);
    expect(top.find((row) => row.name === 'TAN')!.platoon).toBe('SIG');
    expect(top.find((row) => row.name === 'LIM')!.platoon).toBe('Unassigned');
  });
});

describe('topByDays', () => {
  test('sums days only over episodes that state a duration, and ranks on the total', () => {
    const rows = personnelRows([
      // Stated 6-day MC.
      { date: '2026-07-20', session: 'FPS', company: 'Archer', fourD: '1101', name: 'ZED', reasonCategory: 'Att C', startDate: '2026-07-20', endDate: '2026-07-25', numDays: 6 },
      // A second MC with no stated days and no date span — falls back to 1 observed day.
      { date: '2026-08-01', session: 'FPS', company: 'Archer', fourD: '1102', name: 'ADA', reasonCategory: 'Att C' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByDays(episodes, DUTY_CLASS.ATT_C, 10);
    const zed = top.find((entry) => entry.name === 'ZED')!;
    expect(zed.count).toBe(1);
    expect(zed.days).toBe(6);
    expect(zed.meanDays).toBe(6);
    expect(top[0]!.name).toBe('ZED');
  });
});

describe('topByStatusCount', () => {
  test('splits temporary and permanent, and the two sum to the total', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', fourD: '1101', name: 'ZED', reasonCategory: 'Status', reason: 'Excuse RMJ', startDate: '2026-07-20', endDate: '2026-07-27', numDays: 7 },
      { date: '2026-08-15', session: 'FPS', company: 'Archer', fourD: '1101', name: 'ZED', reasonCategory: 'Status', reason: 'Perm Excuse Grenade & Pyro' },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByStatusCount(episodes, 10);
    expect(top[0]!.temporary).toBe(1);
    expect(top[0]!.permanent).toBe(1);
    expect(top[0]!.count).toBe(top[0]!.temporary + top[0]!.permanent);
  });

  test('permanence is read from the reason text, since the 999 sentinel never appears', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', fourD: '1101', name: 'ZED', reasonCategory: 'Status', reason: 'Permanent Excuse Flags', startDate: null, endDate: null, numDays: null },
    ]);
    const episodes = buildEpisodes(rows);
    const top = topByStatusCount(episodes, 10);
    expect(top[0]!.permanent).toBe(1);
    expect(top[0]!.temporary).toBe(0);
  });
});

describe('rankUnits', () => {
  // Two episodes for 1101 (separate days), one for 1102, all Att C in Archer 1; one in Braves 4.
  const episodes = buildEpisodes(
    personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', platoon: '1', fourD: '1101', reasonCategory: 'Att C' },
      { date: '2026-07-24', session: 'FPS', company: 'Archer', platoon: '1', fourD: '1101', reasonCategory: 'Att C' },
      { date: '2026-07-20', session: 'FPS', company: 'Archer', platoon: '1', fourD: '1102', reasonCategory: 'Att C' },
      { date: '2026-07-20', session: 'FPS', company: 'Braves', platoon: '4', fourD: '1201', reasonCategory: 'Att C' },
    ])
  );

  test('ranks companies by episode count and counts each soldier once', () => {
    const ranked = rankUnits(episodes, DUTY_CLASS.ATT_C, 'company');
    expect(ranked.map((row) => [row.company, row.count, row.soldiers])).toEqual([
      ['Archer', 3, 2],
      ['Braves', 1, 1],
    ]);
  });

  test('splits by platoon at the platoon level', () => {
    const ranked = rankUnits(episodes, DUTY_CLASS.ATT_C, 'platoon');
    expect(ranked[0]).toMatchObject({ company: 'Archer', platoon: '1', count: 3, soldiers: 2 });
  });
});

describe('soldierLoad', () => {
  test('lists each soldier by days lost and sums what the top few hold', () => {
    const episodes = [
      episode({ key: 'a', name: 'A', company: 'Archer', dutyClass: DUTY_CLASS.ATT_C, daysLost: 2, startDate: '2026-10-01' }),
      episode({ key: 'a', name: 'A', company: 'Archer', dutyClass: DUTY_CLASS.ATT_C, daysLost: 1, startDate: '2026-10-05' }),
      episode({ key: 'b', name: 'B', company: 'Braves', dutyClass: DUTY_CLASS.ATT_C, daysLost: 10, startDate: '2026-10-02' }),
      episode({ key: 'c', name: 'C', company: 'Cougar', dutyClass: DUTY_CLASS.ATT_C, daysLost: 1, startDate: '2026-10-02' }),
    ];
    const load = soldierLoad(episodes, DUTY_CLASS.ATT_C, 1);
    expect(load.entries.map((e) => [e.name, e.episodes, e.daysLost])).toEqual([
      ['B', 1, 10],
      ['A', 2, 3],
      ['C', 1, 1],
    ]);
    expect([load.topDays, load.totalDays]).toEqual([10, 14]);
  });
});
