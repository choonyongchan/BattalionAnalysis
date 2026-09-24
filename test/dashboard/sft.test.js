/**
 * The SFT model. Expectations are counted by hand off the rows below. NAMES ARE SYNTHETIC.
 */
import { describe, expect, test } from 'bun:test';
import {
  averageGroupSize,
  byCompany,
  fuzzyNamesMatch,
  groupIcClusters,
  groupSizeDistribution,
  groupSizes,
  soldierCount,
  toSftRecords,
  topExercises,
  topLocations,
} from '../../src/model/sft.js';

/**
 * One SFT Responses row, keyed by `SFT_HEADERS`.
 * @param {!Object} fields Overrides.
 * @returns {!Object} The row.
 */
function row(fields) {
  return {
    Timestamp: fields.date + 'T18:00:00',
    date: '2026-09-18',
    RANK: 'PTE',
    name: 'ECHO TAN',
    company: 'Archer',
    group_ic: '3SG FOXTROT LIM',
    'PES Status': 'A',
    exercises: 'Run',
    sfabt_type: 'N/A',
    location: 'Camp Stadium',
    ...fields,
  };
}

const ROWS = [
  row({ name: 'ECHO TAN', group_ic: '3SG FOXTROT LIM', exercises: 'Run; Push-ups' }),
  row({ name: 'GOLF ONG', group_ic: 'Foxtrot Lim', location: 'camp  stadium' }),
  row({ name: 'HOTEL NG', company: 'Braves', group_ic: '3SG FOXTROT LIMM', exercises: 'Run; Sit-ups' }),
  row({ name: 'INDIA KOH', company: 'Braves', group_ic: 'LTA JULIET WEE', exercises: 'Swim', location: 'Camp Pool' }),
  row({ name: 'KILO SIM', group_ic: '' }),
  row({ date: '2026-09-19', name: 'ECHO TAN', group_ic: '3SG FOXTROT LIM' }),
];

const RECORDS = toSftRecords(ROWS);

describe('counts', () => {
  test('soldiers are counted once however many sessions they file', () => {
    expect(RECORDS).toHaveLength(6);
    expect(soldierCount(RECORDS)).toBe(5);
  });

  test('every company is listed, zero-filled', () => {
    expect(byCompany(RECORDS)).toEqual([
      { company: 'Archer', sessions: 4, soldiers: 3 },
      { company: 'Braves', sessions: 2, soldiers: 2 },
      { company: 'Cougar', sessions: 0, soldiers: 0 },
      { company: 'Stallion', sessions: 0, soldiers: 0 },
      { company: 'Hercules', sessions: 0, soldiers: 0 },
    ]);
  });

  test('locations merge case and spacing variants', () => {
    expect(topLocations(RECORDS, 5)).toEqual([
      { label: 'Camp Stadium', count: 5 },
      { label: 'Camp Pool', count: 1 },
    ]);
  });

  test('each exercise in a session counts once', () => {
    expect(topExercises(RECORDS, 2)).toEqual([
      { label: 'Run', count: 5 },
      { label: 'Push-ups', count: 1 },
    ]);
  });
});

describe('group size', () => {
  test('one IC spelt three ways is one group; a second IC stays apart; a blank IC is no group', () => {
    const day = groupIcClusters(RECORDS.filter((r) => r.date === '2026-09-18'));
    expect(day.map((c) => [c.label, c.members.length])).toEqual([
      ['3SG FOXTROT LIM', 3],
      ['LTA JULIET WEE', 1],
    ]);
  });

  test('the same IC on another day is another group', () => {
    expect(groupIcClusters(RECORDS)).toHaveLength(3);
  });

  test('two ICs sharing a surname are not merged', () => {
    const records = toSftRecords([row({ group_ic: 'TAN WEI MING' }), row({ name: 'X Y', group_ic: 'TAN WEI LIANG' })]);
    expect(groupIcClusters(records)).toHaveLength(2);
  });

  test.each([
    ['a one-letter surname slip', 'TAN WEI MING', 'tan wei minh', true],
    ['word order and a rank', 'LTA JULIET WEE', 'Wee Juliet', true],
    ['a different given name', 'TAN WEI MING', 'TAN WEI LIANG', false],
    ['different people', 'FOXTROT LIM', 'JULIET WEE', false],
  ])('fuzzyNamesMatch: %s', (_name, a, b, same) => {
    expect(fuzzyNamesMatch(a, b)).toBe(same);
  });

  test('a group counts its members plus the IC, and the IC once if the IC filed too', () => {
    const records = toSftRecords([
      row({ name: 'ECHO TAN', group_ic: 'FOXTROT LIM' }),
      row({ name: 'FOXTROT LIM', group_ic: '3SG Foxtrot Lim' }),
    ]);
    expect(groupSizes(records).map((g) => g.size)).toEqual([2]);
  });

  test('sizes, majority company, average and distribution match a hand count', () => {
    const groups = groupSizes(RECORDS);
    expect(groups).toEqual([
      { date: '2026-09-18', ic: '3SG FOXTROT LIM', company: 'Archer', size: 4 },
      { date: '2026-09-18', ic: 'LTA JULIET WEE', company: 'Braves', size: 2 },
      { date: '2026-09-19', ic: '3SG FOXTROT LIM', company: 'Archer', size: 2 },
    ]);
    expect(averageGroupSize(groups)).toBeCloseTo(8 / 3);
    expect(groupSizeDistribution(groups)).toEqual([
      { size: 1, count: 0 },
      { size: 2, count: 2 },
      { size: 3, count: 0 },
      { size: 4, count: 1 },
    ]);
  });

  test('no groups means no average', () => {
    expect(averageGroupSize([])).toBeNull();
  });
});
