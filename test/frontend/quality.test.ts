/** Tests for the data-quality figures: every one a fraction with both parts, never a bare percentage. */

import { describe, expect, test } from 'bun:test';
import { dataset, personnelRows, reportSickRow, sectionCountRow, strengthRows } from './fixtures.ts';
import { dataQuality, countMismatches } from '../../frontend/src/model/quality.ts';

describe('dataQuality', () => {
  test('reports both date spans separately', () => {
    const strength = strengthRows([
      { date: '2026-07-11', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100 },
      { date: '2026-09-02', session: 'FPS', company: 'Archer', platoon: 'Company', unitType: 'Company', totalStrength: 100 },
    ]);
    const formSg = [reportSickRow({ timestamp: '2026-05-07T08:15:00' }), reportSickRow({ timestamp: '2026-09-02T21:40:00' })];
    const quality = dataQuality(dataset({ strength, formSg }));
    expect(quality.paradeStateSpan).toEqual({ from: '2026-07-11', to: '2026-09-02' });
    expect(quality.formSgSpan).toEqual({ from: '2026-05-07', to: '2026-09-02' });
  });

  test('a dataset with an empty optional list reports why', () => {
    const quality = dataQuality(dataset({ notes: { 'Public Holidays': 'No public holidays are set.' } }));
    expect(quality.notes['Public Holidays']).toContain('public holidays');
  });

  test('every fraction carries both a numerator and a denominator', () => {
    const personnel = personnelRows([
      { reasonCategory: 'Status', reason: 'Perm Excuse Flags', numDays: null },
      { reasonCategory: 'Att C', numDays: 3 },
    ]);
    const quality = dataQuality(dataset({ personnel }));
    expect(quality.statusDuration).toEqual({ total: 1, blank: 1 });
    expect(quality.attCDuration).toEqual({ total: 1, blank: 0 });
    expect(quality.fourD).toEqual({ total: 2, blank: 2 });
  });

  test('the permanent-status sentinel finding names both counts', () => {
    const personnel = personnelRows([
      { reasonCategory: 'Status', reason: 'Perm Excuse Flags', numDays: null },
      { reasonCategory: 'Status', reason: 'Excuse RMJ', startDate: '2026-07-20', endDate: '2026-07-21', numDays: 2 },
    ]);
    const quality = dataQuality(dataset({ personnel }));
    expect(quality.permanentStatusSentinel.readAsPermanent).toBe(1);
    expect(quality.permanentStatusSentinel.carryingSentinel).toBe(0);
  });
});

describe('countMismatches', () => {
  test('counts sections whose stated count differs from the names listed under them', () => {
    const counts = [
      sectionCountRow({ paradeResponseId: 'p1', date: '2026-10-08', company: 'Archer', platoon: '1', reasonCategory: 'Att C', statedCount: 2 }),
      sectionCountRow({ paradeResponseId: 'p1', date: '2026-10-08', company: 'Archer', platoon: '1', reasonCategory: 'MA', statedCount: 1 }),
      sectionCountRow({ paradeResponseId: 'p1', date: '2026-10-08', company: 'Archer', platoon: '2', reasonCategory: 'Status', statedCount: null }),
    ];
    const personnel = personnelRows([
      { paradeResponseId: 'p1', platoon: '1', reasonCategory: 'Att C' },
      { paradeResponseId: 'p1', platoon: '1', reasonCategory: 'MA' },
    ]);
    expect(countMismatches(counts, personnel)).toEqual({
      cells: [{ row: 'Archer', column: '2026-10-08', value: 1, sections: ['1 Att C: states 2, lists 1'] }],
      checked: 2,
      mismatched: 1,
    });
  });
});
