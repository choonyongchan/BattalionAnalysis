/**
 * Tests for the data-quality figures every panel's coverage line reads from.
 *
 * The case worth having throughout is that every figure comes back as a fraction with
 * both parts — a chart that only ever printed "89%" would have nowhere to put "8/9".
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../src/data/records.js';
import { PERSONNEL_HEADERS, STRENGTH_HEADERS } from '../src/data/tabs.js';
import { companyCoverage, dataQuality, paradeDayCoverage } from '../src/model/quality.js';

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

describe('companyCoverage', () => {
  test('a company that filed nothing in range reports zero of the expected days', () => {
    const rows = strengthRows([
      { date: '2026-07-20', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100 },
      { date: '2026-07-21', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100 },
    ]);
    const coverage = companyCoverage(rows, null, null);
    const braves = coverage.find((entry) => entry.company === 'Braves');
    expect(braves.days).toBe(0);
    expect(braves.expectedDays).toBe(2);
    expect(braves.share).toBe(0);
  });
});

describe('paradeDayCoverage', () => {
  test('a range with no parade days at all reports a zero share, not a division error', () => {
    expect(paradeDayCoverage(strengthRows([]), null, null)).toEqual({ days: 0, fullDays: 0, share: 0 });
  });

  test('counts only the days every company filed as full', () => {
    const rows = strengthRows([
      ...['Archer', 'Braves', 'Cougar', 'Stallion', 'Scorpion', 'Hercules'].map((company) => ({
        date: '2026-07-20', session: 'FPS', company, platoon: 'Company', unit_type: 'Company', total_strength: 100,
      })),
      { date: '2026-07-21', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100 },
    ]);
    const coverage = paradeDayCoverage(rows, null, null);
    expect(coverage.days).toBe(2);
    expect(coverage.fullDays).toBe(1);
    expect(coverage.share).toBe(0.5);
  });
});

describe('dataQuality', () => {
  test('reports both date spans separately', () => {
    const strength = strengthRows([
      { date: '2026-07-11', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100 },
      { date: '2026-09-02', session: 'FPS', company: 'Archer', platoon: 'Company', unit_type: 'Company', total_strength: 100 },
    ]);
    const formSg = [{ date: '2026-05-07' }, { date: '2026-09-02' }];
    const quality = dataQuality({ strength, personnel: [], formSg, notes: {} });
    expect(quality.paradeStateSpan).toEqual({ from: '2026-07-11', to: '2026-09-02' });
    expect(quality.formSgSpan).toEqual({ from: '2026-05-07', to: '2026-09-02' });
  });

  test('a dataset with optional tabs absent reports them by name', () => {
    const quality = dataQuality({
      strength: [],
      personnel: [],
      formSg: [],
      notes: { 'Public Holidays': 'The spreadsheet has no "Public Holidays" tab.' },
    });
    expect(quality.optionalTabs['Public Holidays']).toContain('Public Holidays');
  });

  test('every fraction carries both a numerator and a denominator', () => {
    const personnel = personnelRows([
      { reason_category: 'Status', reason: 'Perm Excuse Flags', num_days: '' },
      { reason_category: 'Att C', num_days: 3 },
    ]);
    const quality = dataQuality({ strength: [], personnel, formSg: [], notes: {} });
    expect(quality.statusDuration).toEqual({ total: 1, blank: 1 });
    expect(quality.attCDuration).toEqual({ total: 1, blank: 0 });
    expect(quality.fourD).toEqual({ total: 2, blank: 2 });
  });

  test('the permanent-status sentinel finding names both counts', () => {
    const personnel = personnelRows([
      { reason_category: 'Status', reason: 'Perm Excuse Flags', num_days: '' },
      { reason_category: 'Status', reason: 'Excuse RMJ', start_date: '2026-07-20', end_date: '2026-07-21', num_days: 2 },
    ]);
    const quality = dataQuality({ strength: [], personnel, formSg: [], notes: {} });
    expect(quality.permanentStatusSentinel.readAsPermanent).toBe(1);
    expect(quality.permanentStatusSentinel.carryingSentinel).toBe(0);
  });
});
