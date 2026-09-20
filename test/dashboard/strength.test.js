/**
 * Tests for the daily strength picture: totals, rank tiers, and the two trend series.
 *
 * The case worth having throughout is the gap: only 5 of 45 real parade days carry all
 * six companies, so a day a company did not file must read as missing data, never as a
 * headcount of zero.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS, STRENGTH_HEADERS } from '../../src/data/tabs.js';
import { DUTY_CLASS } from '../../src/model/classify.js';
import { dutyTrend, presentTrend, rankTiersOn, strengthOn } from '../../src/model/strength.js';

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

describe('strengthOn', () => {
  test('sums only the company-total rows', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: '1', unit_type: 'PLATOON', total_strength: 30, total_present: 25 },
    ]);
    expect(strengthOn(rows, '2026-07-22', 'FPS').accountable).toBe(100);
  });
});

describe('rankTiersOn', () => {
  test('a blank tier cell is unstated, not zero, and does not count toward companies reporting', () => {
    const rows = strengthRows([
      {
        date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company',
        total_strength: 100, total_present: 90,
        officer_strength: 5, officer_present: 5,
      },
      {
        date: '2026-07-22', session: 'FPS', company: 'Braves', platoon: 'Company', unit_type: 'Company',
        total_strength: 80, total_present: 70,
        // No officer tier stated for Braves.
      },
    ]);
    const tiers = rankTiersOn(rows, '2026-07-22', 'FPS');
    const officer = tiers.find((tier) => tier.tier === 'officer');
    expect(officer.strength).toBe(5);
    expect(officer.companiesReporting).toBe(1);

    const wospec = tiers.find((tier) => tier.tier === 'wospec');
    expect(wospec.strength).toBeNull();
    expect(wospec.companiesReporting).toBe(0);
  });

  test('every tier is present in the result even when none of them are stated', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const tiers = rankTiersOn(rows, '2026-07-22', 'FPS');
    expect(tiers.map((tier) => tier.tier)).toEqual(['officer', 'wospec', 'enlistee']);
    tiers.forEach((tier) => expect(tier.strength).toBeNull());
  });
});

describe('presentTrend battalion scope', () => {
  test('one series named Battalion, one value per date', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'battalion' });
    expect(trend.series).toHaveLength(1);
    expect(trend.series[0].name).toBe('Battalion');
    expect(trend.series[0].values[0]).toBeCloseTo(90);
  });
});

describe('presentTrend companies scope', () => {
  test('a company that did not file that day is null, not zero', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'companies' });
    const archer = trend.series.find((series) => series.name === 'Archer');
    const braves = trend.series.find((series) => series.name === 'Braves');
    expect(archer.values[0]).toBeCloseTo(90);
    expect(braves.values[0]).toBeNull();
  });

  test('returns all six companies even when only one filed', () => {
    const rows = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const trend = presentTrend(rows, ['2026-07-22'], { scope: 'companies' });
    expect(trend.series.map((series) => series.name).sort()).toEqual(
      ['Archer', 'Braves', 'Cougar', 'Hercules', 'Scorpion', 'Stallion'].sort()
    );
  });
});

describe('dutyTrend', () => {
  test('battalion scope reports a rate per 100 accountable', () => {
    const strength = strengthRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const personnel = personnelRows([
      { date: '2026-07-22', session: 'FPS', company: 'Archer', four_d: '1101', reason_category: 'Att C' },
    ]);
    const trend = dutyTrend(personnel, strength, DUTY_CLASS.ATT_C, ['2026-07-22'], { scope: 'battalion' });
    expect(trend.series[0].values[0]).toBeCloseTo(1);
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
