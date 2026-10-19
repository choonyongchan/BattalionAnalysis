/** Tests for the recently-back list. */

import { describe, expect, test } from 'bun:test';
import type { PersonnelRow } from '../../shared/dashboard.ts';
import { personnelRows } from './fixtures.ts';
import { recentlyReturned } from '../../frontend/src/model/recentReturns.ts';

const DAY = '2026-09-22';

/** One personnel line, filed on its end date unless the spec says otherwise; an Archer MC by default. */
function line(spec: Partial<PersonnelRow>): Partial<PersonnelRow> {
  return { date: spec.endDate || DAY, session: 'FPS', company: 'Archer', reasonCategory: 'Att C', ...spec };
}

/** [name, kind, daysBack] for each row the list gives over these lines. */
function listed(specs: Partial<PersonnelRow>[]) {
  return recentlyReturned(personnelRows(specs.map(line)), DAY).map((row) => [
    row.name,
    row.kind,
    row.daysBack,
  ]);
}

describe('recentlyReturned', () => {
  test('lists MC one and two days after its end, and not on its end day or the third day', () => {
    expect(
      listed([
        { fourD: '1', name: 'ONE', endDate: '2026-09-21' },
        { fourD: '2', name: 'TWO', endDate: '2026-09-20' },
        { fourD: '3', name: 'THREE', endDate: '2026-09-19' },
        { fourD: '4', name: 'TODAY', endDate: '2026-09-22', date: '2026-09-21' },
      ])
    ).toEqual([
      ['ONE', 'MC', 1],
      ['TWO', 'MC', 2],
    ]);
  });

  test('lists Light Duty only the day after its end, and no other status', () => {
    const status = { reasonCategory: 'Status' } as const;
    expect(
      listed([
        { ...status, fourD: '1', name: 'LD', reason: 'LD 5 DAYS', endDate: '2026-09-21' },
        { ...status, fourD: '2', name: 'LD OLD', reason: 'Light Duty', endDate: '2026-09-20' },
        { ...status, fourD: '3', name: 'RMJ', reason: 'Excuse RMJ', endDate: '2026-09-21' },
        { ...status, fourD: '4', name: 'PERM', reason: 'PERM LD' },
      ])
    ).toEqual([['LD', 'Light Duty', 1]]);
  });

  test('leaves out MA, leave and an MC with no end date', () => {
    expect(
      listed([
        { fourD: '1', name: 'MA', reasonCategory: 'MA', endDate: '2026-09-21' },
        { fourD: '2', name: 'LEAVE', reasonCategory: 'Off/Leave', endDate: '2026-09-21' },
        { fourD: '3', name: 'OPEN', date: '2026-09-21' },
      ])
    ).toEqual([]);
  });

  test('reads the end date from the latest parade, so an extended MC is not back', () => {
    expect(
      listed([
        { fourD: '1', name: 'EXTENDED', endDate: '2026-09-21', date: '2026-09-20' },
        { fourD: '1', name: 'EXTENDED', endDate: '2026-09-24', date: '2026-09-21' },
      ])
    ).toEqual([]);
  });

  test('does not list a soldier still on the parade itself, whatever his end date says', () => {
    expect(listed([{ fourD: '1', name: 'STALE', endDate: '2026-09-21', date: DAY }])).toEqual([]);
  });
});
