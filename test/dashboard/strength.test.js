/**
 * Tests for the daily strength picture: totals, rank tiers, and the two trend series.
 *
 * The case worth having throughout is the gap: only 5 of 45 real parade days carry all
 * six companies, so count trends explicitly report zero when a company did not file.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS, STRENGTH_HEADERS } from '../../src/data/tabs.js';
import { DUTY_CLASS } from '../../src/model/classify.js';
import { dutyTrend, presentTrend, tierPresence } from '../../src/model/strength.js';

/**
 * Builds Strength Data records from column-keyed row specs.
 * @param {Array<!Object>} specs Partial records; unlisted headers read as ''.
 * @returns {Array<!Object>} Normalised records.
 */
function strengthRows(specs) {
  const values = [
    STRENGTH_HEADERS.slice(),
    ...specs.map((spec) => STRENGTH_HEADERS.map((header) => (header in spec ? spec[header] : ''))),
  ];
  return toRecords(values, STRENGTH_HEADERS, 'Strength Data');
}

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

describe('presentTrend battalion scope', () => {
  test('one series named Battalion carrying the present headcount, not a percentage', () => {
    // 90 of 200: a headcount and a percentage are different numbers here, so the fixture
    // fails loudly if this ever goes back to a rate.
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 200, total_present: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'battalion' });
    expect(trend.series).toHaveLength(1);
    expect(trend.series[0].name).toBe('Battalion');
    expect(trend.series[0].values[0]).toBe(90);
  });

  test('sums the companies that filed', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 200, total_present: 90 },
      { date: '2026-07-22', session: 'FPS', company: 'Braves', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 60 },
    ]);
    expect(presentTrend(rows, ['2026-07-22'], { scope: 'battalion' }).series[0].values[0]).toBe(150);
  });

  test('a day no company filed reports zero, not a residual headcount', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 200, total_present: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22', '2026-07-23'], { scope: 'battalion' });
    expect(trend.series[0].values).toEqual([90, 0]);
  });
});

describe('presentTrend companies scope', () => {
  test('a company that did not file that day reports zero', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 200, total_present: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'companies' });
    const archer = trend.series.find((series) => series.name === 'Archer');
    const braves = trend.series.find((series) => series.name === 'Braves');
    expect(archer.values[0]).toBe(90);
    expect(braves.values[0]).toBe(0);
  });

  test('returns all five companies even when only one filed', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 200, total_present: 90 },
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
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', four_d: '1101', reason_category: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], { scope: 'battalion' });
    expect(trend.series[0].values[0]).toBe(1);
  });

  test('companies scope credits the count to the soldier\'s own company only', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 99 },
      { date: '2026-07-22', session: 'FPS', company: 'Braves', platoon: 'Company', unit_type: 'Company', total_strength: 80, total_present: 80 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', four_d: '1101', reason_category: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], { scope: 'companies' });
    const archer = trend.series.find((series) => series.name === 'Archer');
    const braves = trend.series.find((series) => series.name === 'Braves');
    expect(archer.values[0]).toBeGreaterThan(0);
    expect(braves.values[0]).toBe(0);
  });

  test('a soldier appearing on both FPS and LPS counts once', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', four_d: '1101', reason_category: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], {
      scope: 'companies',
      asRate: false,
    });
    expect(trend.series.find((s) => s.name === 'Archer').values[0]).toBe(1);
  });

  test('asRate:false returns the raw count instead of a percentage', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', four_d: '1101', reason_category: 'Att C' },
      { date: '2026-07-22', session: 'FPS', company: 'Archer', four_d: '1102', reason_category: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], {
      scope: 'battalion',
      asRate: false,
    });
    expect(trend.series[0].values[0]).toBe(2);
  });
});

describe('tierPresence', () => {
  const tiers = (officer, wospec, enlistee) => ({
    officer_strength: officer[0], officer_present: officer[1],
    wospec_strength: wospec[0], wospec_present: wospec[1],
    enlistee_strength: enlistee[0], enlistee_present: enlistee[1],
  });
  const company = (name, split) => ({
    date: '2026-09-22', session: 'FPS', company: name, unit_type: 'Company', total_strength: 1, total_present: 1, ...split,
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
    expect(battalion[0].percent).toBeCloseTo(80);
    expect(byCompany.map((entry) => entry.company)).toEqual(['Archer', 'Braves']);
    expect(byCompany[0].tiers[0].percent).toBeCloseTo(50);
  });

  test('a tier a company did not state is a gap in its row and left out of the sum, not zero', () => {
    const rows = strengthRows([
      company('Archer', tiers([4, 2], [10, 9], [80, 72])),
      company('Cougar', tiers(['', ''], [5, 5], [40, 40])),
      company('Stallion', {}),
    ]);
    const { battalion, byCompany, companiesWithoutSplit } = tierPresence(rows, '2026-09-22');
    expect(battalion[0]).toMatchObject({ strength: 4, present: 2 });
    expect(byCompany.find((entry) => entry.company === 'Cougar').tiers[0].percent).toBeNull();
    expect(companiesWithoutSplit).toEqual(['Stallion']);
  });

  test('a day with no parade has no tiers', () => {
    const { battalion, byCompany } = tierPresence(strengthRows([]), '2026-09-22');
    expect(byCompany).toEqual([]);
    expect(battalion.every((tier) => tier.percent === null)).toBe(true);
  });
});
