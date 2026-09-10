/**
 * Tests for the whole-dashboard company filter.
 *
 * The filter's whole claim is that it can live above the model layer without breaking a
 * rate: if `scopeDataset` is fed to the same model functions the pages use, a
 * battalion-scope figure has to come out equal to that company's own figure. The
 * composition cases at the bottom are the ones that pin that claim; the rest guard the
 * passthrough contract and the by-row filtering.
 */

import { describe, expect, test } from 'bun:test';
import {
  ALL_COMPANIES,
  scopeDataset,
  scopeFilings,
  scopeSubmissions,
} from '../../dashboard/src/model/scope.js';
import { battalionStrength } from '../../dashboard/src/model/metrics.js';
import { presentTrend, dutyTrend } from '../../dashboard/src/model/strength.js';
import { DUTY_CLASS } from '../../dashboard/src/model/classify.js';

/**
 * A minimal dataset: two companies, one parade day, one report-sick soldier each.
 * @returns {!Object} A dataset shaped like `data/feed.js`'s `loadAll` output.
 */
function dataset_() {
  return {
    generatedAt: '2026-02-02T00:00:00Z',
    strength: [
      { date: '2026-02-02', session: 'FPS', company: 'Archer', unit_type: 'Company', total_strength: 100, total_present: 90 },
      { date: '2026-02-02', session: 'FPS', company: 'Braves', unit_type: 'Company', total_strength: 200, total_present: 150 },
      { date: '2026-02-02', session: 'FPS', company: 'Archer', platoon: '1', unit_type: 'Platoon', total_strength: 50, total_present: 45 },
      { date: '2026-02-02', session: 'FPS', company: 'Braves', platoon: '1', unit_type: 'Platoon', total_strength: 100, total_present: 75 },
    ],
    personnel: [
      { date: '2026-02-02', session: 'FPS', company: 'Archer', platoon: '1', four_d: '1111A', name: 'A ONE', reason_category: 'Report Sick' },
      { date: '2026-02-02', session: 'FPS', company: 'Braves', platoon: '1', four_d: '2222B', name: 'B TWO', reason_category: 'Report Sick' },
      { date: '2026-02-02', session: 'FPS', company: 'Braves', platoon: '2', four_d: '3333B', name: 'B THREE', reason_category: 'Report Sick' },
    ],
    roster: [
      { date: '2026-02-02', session: 'FPS', company: 'Archer', role: 'CDO', name: 'ARCHER SIX' },
      { date: '2026-02-02', session: 'FPS', company: 'Braves', role: 'CDO', name: 'BRAVES SIX' },
    ],
    formSg: [{ Timestamp: '2026-02-02 08:00:00', '4D Number (REC Only)': '1111A', 'Unit & Coy': 'Archer Coy' }],
  };
}

describe('scopeDataset', () => {
  test('returns the same reference for ALL', () => {
    const data = dataset_();
    expect(scopeDataset(data, ALL_COMPANIES)).toBe(data);
  });

  test('returns the same reference for an unknown company', () => {
    const data = dataset_();
    expect(scopeDataset(data, 'Nonesuch')).toBe(data);
  });

  test('returns null/undefined untouched', () => {
    expect(scopeDataset(null, 'Archer')).toBe(null);
  });

  test('filters personnel, strength and roster to one company', () => {
    const scoped = scopeDataset(dataset_(), 'Braves');
    expect(scoped.personnel.every((row) => row.company === 'Braves')).toBe(true);
    expect(scoped.strength.every((row) => row.company === 'Braves')).toBe(true);
    expect(scoped.roster.every((row) => row.company === 'Braves')).toBe(true);
    expect(scoped.personnel).toHaveLength(2);
    expect(scoped.strength).toHaveLength(2);
  });

  test('leaves formSg and other keys in place', () => {
    const scoped = scopeDataset(dataset_(), 'Archer');
    expect(scoped.formSg).toHaveLength(1);
    expect(scoped.generatedAt).toBe('2026-02-02T00:00:00Z');
  });
});

describe('scopeSubmissions', () => {
  const subs = [
    { company: 'Archer', key: '4D:1111A' },
    { company: 'Braves', key: '4D:2222B' },
    { company: '', key: 'NAME:NOBODY' },
  ];

  test('is a passthrough for ALL', () => {
    expect(scopeSubmissions(subs, ALL_COMPANIES)).toBe(subs);
  });

  test('keeps only the named company and drops blank-company rows', () => {
    expect(scopeSubmissions(subs, 'Archer')).toEqual([{ company: 'Archer', key: '4D:1111A' }]);
  });
});

describe('scopeFilings', () => {
  const entries = [
    { company: 'Archer', filed: true },
    { company: 'Braves', filed: false },
  ];

  test('is a passthrough for ALL', () => {
    expect(scopeFilings(entries, ALL_COMPANIES)).toBe(entries);
  });

  test('keeps the one selected lane', () => {
    expect(scopeFilings(entries, 'Braves')).toEqual([{ company: 'Braves', filed: false }]);
  });
});

describe('composition: a scoped dataset yields that company\'s own rate', () => {
  test('battalionStrength on scoped rows is the company present/strength', () => {
    const scoped = scopeDataset(dataset_(), 'Archer');
    const strength = battalionStrength(scoped.strength, '2026-02-02', 'FPS');
    expect(strength.accountable).toBe(100);
    expect(strength.present).toBe(90);
    expect(strength.percentPresent).toBe(90);
  });

  test('presentTrend (battalion scope) on scoped rows equals the company ratio', () => {
    const scoped = scopeDataset(dataset_(), 'Braves');
    const trend = presentTrend(scoped.strength, ['2026-02-02'], { scope: 'battalion', session: 'FPS' });
    expect(trend.series[0].values[0]).toBe(75);
  });

  test('dutyTrend (battalion scope) on scoped rows is the company per-100', () => {
    const scoped = scopeDataset(dataset_(), 'Braves');
    const trend = dutyTrend(scoped.personnel, scoped.strength, DUTY_CLASS.REPORT_SICK, ['2026-02-02'], {
      scope: 'battalion',
      session: 'FPS',
    });
    // 2 report-sick soldiers in Braves against 200 accountable = 1 per 100.
    expect(trend.series[0].values[0]).toBe(1);
  });
});
