/**
 * Tests for the soldier index, the per-soldier report, and fuzzy search.
 *
 * The two orderings in `soldierReport` are asserted explicitly because they are opposite
 * on purpose: absences read newest-first as history, 'Others' rows read oldest-first as a
 * narrative, and swapping either silently would not fail loudly anywhere else.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../src/data/records.js';
import { PERSONNEL_HEADERS } from '../src/data/tabs.js';
import { buildEpisodes } from '../src/model/episodes.js';
import { toSubmissions } from '../src/model/formsg.js';
import { findSoldier, soldierIndex, soldierReport } from '../src/model/soldier.js';

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

describe('soldierIndex', () => {
  test('a soldier with no 4D is found by name', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', name: '3SG COMMANDER', reason_category: 'Others' },
    ]);
    const index = soldierIndex(rows, []);
    expect(index).toHaveLength(1);
    expect(index[0].key).toBe('NAME:3SG COMMANDER');
  });

  test('a 4D found exactly is keyed on it, not the name', () => {
    const rows = personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1214', name: 'RYAN', reason_category: 'Report Sick' },
    ]);
    const index = soldierIndex(rows, []);
    expect(index[0].key).toBe('4D:1214');
  });

  test('a soldier appearing only in FormSG is still indexed', () => {
    const submissions = toSubmissions([
      {
        Timestamp: '2026-07-20T08:00:00',
        RANK: 'REC',
        '[Myinfo] Name': 'ZED',
        '4D Number (REC Only)': '4409',
        'Unit & Coy': '40 SAR / Archer',
        'Report Sick Type': 'Report Sick In-Camp (RSI)',
      },
    ]);
    const index = soldierIndex([], submissions);
    expect(index).toHaveLength(1);
    expect(index[0].fourD).toBe('4409');
  });

  test('a platoon filled in on a later submission overwrites an earlier blank', () => {
    const rows = personnelRows([
      { date: '2026-07-01', session: 'FPS', company: 'Hercules', four_d: '3210', name: 'TAN', reason_category: 'Others', platoon: '' },
      { date: '2026-08-01', session: 'FPS', company: 'Hercules', four_d: '3210', name: 'TAN', reason_category: 'Others', platoon: '3' },
    ]);
    const index = soldierIndex(rows, []);
    expect(index[0].platoon).toBe('3');
    expect(index[0].platoonInferred).toBe(false);
  });
});

describe('soldierReport', () => {
  const rows = personnelRows([
    { date: '2026-07-10', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Att C', reason: 'Fever', start_date: '2026-07-10', end_date: '2026-07-12', num_days: 3 },
    { date: '2026-08-01', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Att C', reason: 'Cough', start_date: '2026-08-01', end_date: '2026-08-02', num_days: 2 },
    { date: '2026-07-05', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Others', reason: 'Attached to Med Centre' },
    { date: '2026-08-05', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Others', reason: 'Course' },
    { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Excuse RMJ', start_date: '2026-07-20', end_date: '2026-07-27', num_days: 7 },
  ]);
  const episodes = buildEpisodes(rows);

  test('absences are ordered newest first', () => {
    const report = soldierReport('4D:1101', { personnel: rows, episodes, submissions: [] });
    expect(report.absences.map((a) => a.startDate)).toEqual(['2026-08-01', '2026-07-10']);
  });

  test('others are ordered oldest first, the opposite of absences', () => {
    const report = soldierReport('4D:1101', { personnel: rows, episodes, submissions: [] });
    expect(report.others.map((o) => o.date)).toEqual(['2026-07-05', '2026-08-05']);
  });

  test('counts reflect each duty class independently', () => {
    const report = soldierReport('4D:1101', { personnel: rows, episodes, submissions: [] });
    expect(report.counts.mc).toBe(2);
    expect(report.counts.statuses).toBe(1);
  });

  test('an unknown key returns null', () => {
    expect(soldierReport('4D:9999', { personnel: rows, episodes, submissions: [] })).toBeNull();
  });

  test('identitySource reports how the soldier was matched', () => {
    const namedRows = personnelRows([
      { date: '2026-07-05', session: 'FPS', company: 'Archer', name: '3SG COMMANDER', reason_category: 'Others', reason: 'Attached' },
    ]);
    const namedEpisodes = buildEpisodes(namedRows);
    const report = soldierReport('NAME:3SG COMMANDER', {
      personnel: namedRows,
      episodes: namedEpisodes,
      submissions: [],
    });
    expect(report.identitySource).toBe('name');
  });
});

describe('findSoldier', () => {
  const index = soldierIndex(
    personnelRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', four_d: '1214', name: 'RYAN TAN', reason_category: 'Others' },
      { date: '2026-07-20', session: 'FPS', company: 'Braves', four_d: '2201', name: 'RYAN LIM', reason_category: 'Others' },
    ]),
    []
  );

  test('an exact 4D ranks first even against a fuzzy name collision', () => {
    const results = findSoldier(index, '1214');
    expect(results[0].fourD).toBe('1214');
  });

  test('a name search finds a fuzzy match', () => {
    const results = findSoldier(index, 'ryan');
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  test('a blank query returns nothing rather than everything', () => {
    expect(findSoldier(index, '')).toEqual([]);
  });
});
