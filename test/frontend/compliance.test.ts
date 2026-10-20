/** Tests for report-sick compliance: parade-state names matched to FormSG submissions. */

import { describe, expect, test } from 'bun:test';
import type { PersonnelRow, ReportSickRow } from '../../shared/dashboard.ts';
import { personnelRows, submissionsOf } from './fixtures.ts';
import { reportSickCompliance } from '../../frontend/src/model/compliance.ts';

const DAY = '2026-07-20';

/** A soldier listed under Report Sick on `DAY`. */
function sick(name: string, overrides: Partial<PersonnelRow> = {}): Partial<PersonnelRow> {
  return { date: DAY, company: 'Archer', name, fourD: null, reasonCategory: 'Report Sick', ...overrides };
}

/** A FormSG submission on `DAY`. */
function form(name: string, overrides: Partial<ReportSickRow> = {}): Partial<ReportSickRow> {
  return { timestamp: DAY + 'T09:00:00', name, fourD: null, company: 'Archer', ...overrides };
}

/** Compliance over `DAY` alone. */
function run(parade: Partial<PersonnelRow>[], forms: Partial<ReportSickRow>[]) {
  return reportSickCompliance(personnelRows(parade), submissionsOf(forms), DAY, DAY);
}

describe('reportSickCompliance', () => {
  test('matches on 4D whatever the names say', () => {
    const result = run([sick('TAN AH KOW', { fourD: '1234' })], [form('JOHNNY', { fourD: '1234' })]);
    expect([result.matched, result.missing.length, result.formOnly.length]).toEqual([1, 0, 0]);
  });

  test('matches a full name to a preferred name, and a typo', () => {
    const result = run([sick('NG JUN WEI CALEB'), sick('MUHAMMAD HAFIZ BIN RAHMAN')], [form('Caleb Ng'), form('Muhamad Hafiz Rahman')]);
    expect(result.matched).toBe(2);
    expect(result.compliance).toBe(1);
  });

  test('a form on another day does not count, and one form covers one soldier', () => {
    const result = run(
      [sick('LIM WEI JIE'), sick('LIM WEI JIE', { session: 'LPS' }), sick('CHUA BENG HOCK'), sick('CHUA BENG HOCK', { date: '2026-07-19' })],
      [form('LIM WEI JIE'), form('CHUA BENG HOCK', { timestamp: '2026-07-21T09:00:00' }), form('GOH KAH WEE')],
    );
    expect(result.matched).toBe(1);
    expect(result.missing.map((row) => row.name)).toEqual(['CHUA BENG HOCK']);
    expect(result.formOnly.map((row) => row.name)).toEqual(['GOH KAH WEE']);
    expect(result.compliance).toBe(0.5);
    expect(result.links).toEqual([
      { source: 'Reporting sick', target: 'Reported sick', value: 1 },
      { source: 'Reporting sick', target: 'No FormSG submission', value: 1 },
      { source: 'Unaccounted', target: 'Reported sick', value: 1 },
    ]);
  });

  test('compliance is null with nobody reporting sick', () => {
    expect(run([], [form('GOH KAH WEE')]).compliance).toBeNull();
  });
});
