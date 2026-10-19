/**
 * Tests for the whole-dashboard company filter. It can live above the model because every figure is a
 * unit's own rows: fed a scoped dataset, the same model functions give that company's own figures.
 */

import { describe, expect, test } from 'bun:test';
import { ALL_COMPANIES, onlyCompany, scopeDataset } from '../../frontend/src/model/scope.ts';
import { battalionStrength } from '../../frontend/src/model/metrics.ts';
import { presentTrend, dutyTrend } from '../../frontend/src/model/strength.ts';
import { DUTY_CLASS } from '../../frontend/src/model/classify.ts';
import { dataset, personnelRows, reportSickRow, rosterRow, strengthRows } from './fixtures.ts';

/** Two companies, one parade day, report-sick soldiers in each. */
function twoCompanies() {
  return dataset({
    generatedAt: '2026-02-02T00:00:00Z',
    strength: strengthRows([
      { date: '2026-02-02', company: 'Archer', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
      { date: '2026-02-02', company: 'Braves', unitType: 'Company', totalStrength: 200, totalPresent: 150 },
      { date: '2026-02-02', company: 'Archer', platoon: '1', unitType: 'PLATOON', totalStrength: 50, totalPresent: 45 },
      { date: '2026-02-02', company: 'Braves', platoon: '1', unitType: 'PLATOON', totalStrength: 100, totalPresent: 75 },
    ]),
    personnel: personnelRows([
      { date: '2026-02-02', company: 'Archer', platoon: '1', fourD: '1111A', name: 'A ONE', reasonCategory: 'Report Sick' },
      { date: '2026-02-02', company: 'Braves', platoon: '1', fourD: '2222B', name: 'B TWO', reasonCategory: 'Report Sick' },
      { date: '2026-02-02', company: 'Braves', platoon: '2', fourD: '3333B', name: 'B THREE', reasonCategory: 'Report Sick' },
    ]),
    roster: [
      rosterRow({ date: '2026-02-02', company: 'Archer', role: 'CDO', name: 'ARCHER SIX' }),
      rosterRow({ date: '2026-02-02', company: 'Braves', role: 'CDO', name: 'BRAVES SIX' }),
    ],
    formSg: [
      reportSickRow({ timestamp: '2026-02-02T08:00:00', fourD: '1111A', unitCoy: 'Archer Coy', company: 'Archer' }),
      reportSickRow({ timestamp: '2026-02-02T09:00:00', fourD: '9999', unitCoy: 'Unknown', company: null }),
    ],
  });
}

describe('scopeDataset', () => {
  test('returns the same reference for ALL or an unknown company', () => {
    const data = twoCompanies();
    expect(scopeDataset(data, ALL_COMPANIES)).toBe(data);
    expect(scopeDataset(data, 'Nonesuch')).toBe(data);
  });

  test('returns null untouched', () => {
    expect(scopeDataset(null, 'Archer')).toBe(null);
  });

  test('filters every row array to one company', () => {
    const scoped = scopeDataset(twoCompanies(), 'Braves');
    expect(scoped.personnel.every((row) => row.company === 'Braves')).toBe(true);
    expect(scoped.strength.every((row) => row.company === 'Braves')).toBe(true);
    expect(scoped.roster.every((row) => row.company === 'Braves')).toBe(true);
    expect(scoped.personnel).toHaveLength(2);
    expect(scoped.strength).toHaveLength(2);
  });

  test('keeps a FormSG row only under its own company, and other keys in place', () => {
    const scoped = scopeDataset(twoCompanies(), 'Archer');
    expect(scoped.formSg).toHaveLength(1);
    expect(scoped.generatedAt).toBe('2026-02-02T00:00:00Z');
  });
});

describe('onlyCompany', () => {
  const entries = [
    { company: 'Archer', filed: true },
    { company: 'Braves', filed: false },
    { company: '', filed: false },
  ];

  test('is a passthrough for ALL', () => {
    expect(onlyCompany(entries, ALL_COMPANIES)).toBe(entries);
  });

  test('keeps the one selected company and drops blank-company rows', () => {
    expect(onlyCompany(entries, 'Braves')).toEqual([{ company: 'Braves', filed: false }]);
  });
});

describe("composition: a scoped dataset yields that company's own figures", () => {
  test('battalionStrength on scoped rows is the company present/strength', () => {
    const scoped = scopeDataset(twoCompanies(), 'Archer');
    const strength = battalionStrength(scoped.strength, '2026-02-02', 'FPS');
    expect([strength.accountable, strength.present, strength.percentPresent]).toEqual([100, 90, 90]);
  });

  test("presentTrend (battalion scope) on scoped rows is that company's headcount", () => {
    const scoped = scopeDataset(twoCompanies(), 'Braves');
    const trend = presentTrend(scoped.strength, ['2026-02-02'], { scope: 'battalion', session: 'FPS' });
    expect(trend.series[0]!.values[0]).toBe(150);
  });

  test('dutyTrend (battalion scope) on scoped rows is the company per-100', () => {
    const scoped = scopeDataset(twoCompanies(), 'Braves');
    const trend = dutyTrend(scoped.personnel, scoped.strength, DUTY_CLASS.REPORT_SICK, ['2026-02-02'], { scope: 'battalion', session: 'FPS' });
    // 2 report-sick soldiers in Braves against 200 accountable = 1 per 100.
    expect(trend.series[0]!.values[0]).toBe(1);
  });
});
