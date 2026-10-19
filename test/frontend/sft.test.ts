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
  toSftSessions,
  sftAgainstStatus,
  topExercises,
  topLocations,
} from '../../frontend/src/model/sft.ts';
import type { PersonnelRow, SftSessionRow } from '../../shared/dashboard.ts';
import { personnelRows, sftRow, sftSession } from './fixtures.ts';

/** One SFT row filed at 18:00 on its date. */
function row(fields: Partial<SftSessionRow>): SftSessionRow {
  return sftRow({
    timestamp: (fields.date ?? '2026-09-18') + 'T18:00:00',
    date: '2026-09-18',
    rank: 'PTE',
    name: 'ECHO TAN',
    company: 'Archer',
    groupIc: '3SG FOXTROT LIM',
    pesStatus: 'A',
    exercises: 'Run',
    sfabtType: 'N/A',
    location: 'Camp Stadium',
    ...fields,
  });
}

const ROWS = [
  row({ name: 'ECHO TAN', groupIc: '3SG FOXTROT LIM', exercises: 'Run; Push-ups' }),
  row({ name: 'GOLF ONG', groupIc: 'Foxtrot Lim', location: 'camp  stadium' }),
  row({ name: 'HOTEL NG', company: 'Braves', groupIc: '3SG FOXTROT LIMM', exercises: 'Run; Sit-ups' }),
  row({ name: 'INDIA KOH', company: 'Braves', groupIc: 'LTA JULIET WEE', exercises: 'Swim', location: 'Camp Pool' }),
  row({ name: 'KILO SIM', groupIc: '' }),
  row({ date: '2026-09-19', name: 'ECHO TAN', groupIc: '3SG FOXTROT LIM' }),
];

const RECORDS = toSftSessions(ROWS);

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

  test('spellings of one exercise are counted once per session, under one label', () => {
    const records = [
      sftSession({ exercises: ['Running', 'ER'] }),
      sftSession({ exercises: ['Endurance run'] }),
      sftSession({ exercises: ['Gym / Weights', 'Chest and shoulders'] }),
      sftSession({ exercises: ['Swim'] }),
    ];
    expect(topExercises(records, 5)).toEqual([
      { label: 'Run', count: 2 },
      { label: 'Gym / Weights', count: 1 },
      { label: 'Swim', count: 1 },
    ]);
  });
});

describe('group size', () => {
  test('one IC spelt three ways is one group; a second IC stays apart; a blank IC is no group', () => {
    const day = groupIcClusters(RECORDS.filter((record) => record.date === '2026-09-18'));
    expect(day.map((c) => [c.label, c.members.length])).toEqual([
      ['3SG FOXTROT LIM', 3],
      ['LTA JULIET WEE', 1],
    ]);
  });

  test('the same IC on another day is another group', () => {
    expect(groupIcClusters(RECORDS)).toHaveLength(3);
  });

  test('two ICs sharing a surname are not merged', () => {
    const records = toSftSessions([row({ groupIc: 'TAN WEI MING' }), row({ name: 'X Y', groupIc: 'TAN WEI LIANG' })]);
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
    const records = toSftSessions([
      row({ name: 'ECHO TAN', groupIc: 'FOXTROT LIM' }),
      row({ name: 'FOXTROT LIM', groupIc: '3SG Foxtrot Lim' }),
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

describe('sftAgainstStatus', () => {
  const status = (name: string, fields: Partial<PersonnelRow>): Partial<PersonnelRow> => ({ reasonCategory: 'Status', name, ...fields });

  test('lists sessions on a day the soldier held a training restriction, by date or dated span', () => {
    const records = [
      sftSession({ date: '2026-10-03', rank: 'PTE', name: 'Tan Ah Kow', company: 'Archer', exercises: ['Run'] }),
      sftSession({ date: '2026-10-05', rank: 'PTE', name: 'Lim Bee', company: 'Archer', exercises: ['Gym'] }),
      sftSession({ date: '2026-10-05', rank: 'PTE', name: 'Ng Chee', company: 'Archer', exercises: ['Run'] }),
    ];
    const personnel = personnelRows([
      status('TAN AH KOW', { startDate: '2026-10-01', endDate: '2026-10-07', reason: 'Excuse RMJ' }),
      status('LIM BEE', { date: '2026-10-05', reason: 'Excuse Stay-In' }),
    ]);
    expect(sftAgainstStatus(records, personnel)).toEqual([
      { date: '2026-10-03', rank: 'PTE', name: 'Tan Ah Kow', company: 'Archer', exercises: 'Run', restrictions: 'Excuse RMJ' },
    ]);
  });
});
