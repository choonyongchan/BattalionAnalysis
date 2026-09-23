/**
 * Tests for the FormSG-side "reported sick" leaderboard and company ranking.
 *
 * The case worth having is the one requirement 3.7 runs into: FormSG's "Unit & Coy"
 * answer names a company but never a platoon, so a platoon-level ranking of reported
 * sick is not data this dashboard has — these tests pin the company-only shape rather
 * than letting a future edit quietly invent a platoon column with nothing behind it.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { STRENGTH_HEADERS } from '../../src/data/tabs.js';
import { submissionRateByCompany, toSubmissions, topSubmitters } from '../../src/model/formsg.js';

/**
 * A FormSG response row, as `toSubmissions` reads it.
 * @param {!Object} overrides Fields to set or replace.
 * @returns {!Object} A row with sane defaults.
 */
function row(overrides) {
  return {
    Timestamp: '2026-07-20 08:00:00',
    RANK: 'REC',
    '[Myinfo] Name': 'TAN JUN HAO',
    '4D Number (REC Only)': '3203',
    'Unit & Coy': '40 SAR / Cougar',
    'Report Sick Type': 'Report Sick In-Camp (RSI)',
    ...overrides,
  };
}

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

describe('topSubmitters', () => {
  test('ranks by submission count, ties broken by name', () => {
    const submissions = toSubmissions([
      row({ '4D Number (REC Only)': '1101', '[Myinfo] Name': 'ZED' }),
      row({ '4D Number (REC Only)': '1101', '[Myinfo] Name': 'ZED' }),
      row({ '4D Number (REC Only)': '1102', '[Myinfo] Name': 'ADA' }),
    ]);
    const top = topSubmitters(submissions, 10);
    expect(top[0].name).toBe('ZED');
    expect(top[0].count).toBe(2);
    expect(top).toHaveLength(2);
  });

  test('carries no platoon field at all', () => {
    const submissions = toSubmissions([row({})]);
    expect(topSubmitters(submissions, 10)[0].platoon).toBeUndefined();
  });
});

describe('submissionRateByCompany', () => {
  test('every company appears, zero submissions is a real rate of zero, not absent', () => {
    const submissions = toSubmissions([row({ 'Unit & Coy': '40 SAR / Archer' })]);
    const strength = strengthRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', unit_type: 'Company', total_strength: 100 },
    ]);
    const ranked = submissionRateByCompany(submissions, strength);
    expect(ranked).toHaveLength(5);
    const hercules = ranked.find((r) => r.company === 'Hercules');
    expect(hercules.count).toBe(0);
    expect(hercules.per100).toBeNull();
  });

  test('ranks by rate, not by raw count', () => {
    const submissions = toSubmissions([
      row({ 'Unit & Coy': '40 SAR / Archer' }),
      row({ 'Unit & Coy': '40 SAR / Braves' }),
      row({ 'Unit & Coy': '40 SAR / Braves' }),
    ]);
    const strength = strengthRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', unit_type: 'Company', total_strength: 10 },
      { date: '2026-07-20', session: 'FPS', company: 'Braves', unit_type: 'Company', total_strength: 1000 },
    ]);
    const ranked = submissionRateByCompany(submissions, strength);
    expect(ranked[0].company).toBe('Archer');
  });

  test('a company with no platoon field never appears — only company-level rows exist', () => {
    const ranked = submissionRateByCompany([], []);
    ranked.forEach((row) => expect(row.platoon).toBeUndefined());
  });
});
