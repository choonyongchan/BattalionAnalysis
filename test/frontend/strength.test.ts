/** Tests for the daily strength picture: totals, rank tiers, and the two trend series. */

import { describe, expect, test } from 'bun:test';
import type { PersonnelRow, StrengthRow } from '../../shared/dashboard.ts';
import { personnelRows, strengthRows } from './fixtures.ts';
import type { Company } from '../../shared/domain.ts';
import { DUTY_CLASS } from '../../frontend/src/model/classify.ts';
import { dutyTrend, presentTrend, tierPresence } from '../../frontend/src/model/strength.ts';

describe('presentTrend battalion scope', () => {
  test('one series named Battalion carrying the present headcount, not a percentage', () => {
    // 90 of 200: a headcount and a percentage are different numbers here, so the fixture
    // fails loudly if this ever goes back to a rate.
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 200, totalPresent: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'battalion' });
    expect(trend.series).toHaveLength(1);
    expect(trend.series[0]!.name).toBe('Battalion');
    expect(trend.series[0]!.values[0]).toBe(90);
  });

  test('sums the companies that filed', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 200, totalPresent: 90 },
      { date: '2026-07-22', session: 'FPS', company: 'Braves', platoon: 'Company', unitType: 'Company', totalStrength: 100, totalPresent: 60 },
    ]);
    expect(presentTrend(rows, ['2026-07-22'], { scope: 'battalion' }).series[0]!.values[0]).toBe(150);
  });

  test('a day no company filed reports zero, not a residual headcount', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 200, totalPresent: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22', '2026-07-23'], { scope: 'battalion' });
    expect(trend.series[0]!.values).toEqual([90, 0]);
  });
});

describe('presentTrend companies scope', () => {
  test('a company that did not file that day reports zero', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 200, totalPresent: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'companies' });
    const archer = trend.series.find((series) => series.name === 'Archer')!;
    const braves = trend.series.find((series) => series.name === 'Braves')!;
    expect(archer.values[0]).toBe(90);
    expect(braves.values[0]).toBe(0);
  });

  test('returns all five companies even when only one filed', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 200, totalPresent: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'companies' });
    expect(trend.series.map((series) => series.name).sort()).toEqual(
      ['Archer', 'Braves', 'Cougar', 'Hercules', 'Stallion'].sort()
    );
  });
});

describe('dutyTrend', () => {
  test('battalion scope reports a raw count', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', fourD: '1101', reasonCategory: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], { scope: 'battalion' });
    expect(trend.series[0]!.values[0]).toBe(1);
  });

  test('companies scope credits the count to the soldier\'s own company only', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100, totalPresent: 99 },
      { date: '2026-07-22', session: 'FPS', company: 'Braves', platoon: 'Company', unitType: 'Company', totalStrength: 80, totalPresent: 80 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', fourD: '1101', reasonCategory: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], { scope: 'companies' });
    const archer = trend.series.find((series) => series.name === 'Archer')!;
    const braves = trend.series.find((series) => series.name === 'Braves')!;
    expect(archer.values[0]).toBeGreaterThan(0);
    expect(braves.values[0]).toBe(0);
  });

  test('a soldier appearing on both FPS and LPS counts once', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', fourD: '1101', reasonCategory: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], {
      scope: 'companies',
      asRate: false,
    });
    expect(trend.series.find((s) => s.name === 'Archer')!.values[0]).toBe(1);
  });

  test('asRate:false returns the raw count instead of a percentage', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', fourD: '1101', reasonCategory: 'Att C' },
      { date: '2026-07-22', session: 'FPS', company: 'Archer', fourD: '1102', reasonCategory: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], {
      scope: 'battalion',
      asRate: false,
    });
    expect(trend.series[0]!.values[0]).toBe(2);
  });

  test('count trends report zero when no parade state covers the day', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', fourD: '1101', reasonCategory: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22', '2026-07-23'], {
      scope: 'battalion',
      asRate: false,
    });
    expect(trend.series[0]!.values).toEqual([1, 0]);
  });
});

describe('tierPresence', () => {
  type Pair = [number | null, number | null];
  const tiers = (officer: Pair, wospec: Pair, enlistee: Pair): Partial<StrengthRow> => ({
    officerStrength: officer[0], officerPresent: officer[1],
    wospecStrength: wospec[0], wospecPresent: wospec[1],
    enlisteeStrength: enlistee[0], enlisteePresent: enlistee[1],
  });
  const company = (name: Company, split: Partial<StrengthRow>): Partial<StrengthRow> => ({
    date: '2026-09-22', session: 'FPS', company: name, unitType: 'Company', totalStrength: 1, totalPresent: 1, ...split,
  });

  test('sums each tier across the companies that filed, with its percentage', () => {
    const rows = strengthRows([
      company('Archer', tiers([4, 2], [10, 9], [80, 72])),
      company('Braves', tiers([6, 6], [10, 10], [70, 70])),
    ]);
    const { battalion, byCompany } = tierPresence(rows, '2026-09-22');
    expect(battalion.map((tier) => [tier.label, tier.strength, tier.present])).toEqual([
      ['Officers', 10, 8],
      ['WOSpecs', 20, 19],
      ['Enlistees', 150, 142],
    ]);
    expect(battalion[0]!.percent).toBeCloseTo(80);
    expect(byCompany.map((entry) => entry.company)).toEqual(['Archer', 'Braves']);
    expect(byCompany[0]!.tiers[0]!.percent).toBeCloseTo(50);
  });

  test('a tier a company did not state is a gap in its row and left out of the sum, not zero', () => {
    const rows = strengthRows([
      company('Archer', tiers([4, 2], [10, 9], [80, 72])),
      company('Cougar', tiers([null, null], [5, 5], [40, 40])),
      company('Stallion', {}),
    ]);
    const { battalion, byCompany, companiesWithoutSplit } = tierPresence(rows, '2026-09-22');
    expect(battalion[0]).toMatchObject({ strength: 4, present: 2 });
    expect(byCompany.find((entry) => entry.company === 'Cougar')!.tiers[0]!.percent).toBeNull();
    expect(companiesWithoutSplit).toEqual(['Stallion']);
  });

  test('a day with no parade has no tiers', () => {
    const { battalion, byCompany } = tierPresence(strengthRows([]), '2026-09-22');
    expect(byCompany).toEqual([]);
    expect(battalion.every((tier) => tier.percent === null)).toBe(true);
  });
});
