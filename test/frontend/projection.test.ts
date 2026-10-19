/** Tests for the return-to-duty list. */

import { describe, expect, test } from 'bun:test';
import type { PersonnelRow } from '../../shared/dashboard.ts';
import { personnelRows } from './fixtures.ts';
import { awayAhead, returnsToDuty, type ReturnRow } from '../../frontend/src/model/projection.ts';

const DAY = '2026-09-22';

/** One personnel line on DAY: an Archer MC unless the spec says otherwise. */
function line(spec: Partial<PersonnelRow>): Partial<PersonnelRow> {
  return { date: DAY, session: 'FPS', company: 'Archer', reasonCategory: 'Att C', ...spec };
}

describe('returnsToDuty', () => {
  test('lists each absent soldier once with the day he is back, soonest first, open-ended last', () => {
    const personnel = personnelRows([
      line({ fourD: '1', name: 'LATE', endDate: '2026-09-30' }),
      line({ fourD: '2', name: 'OPEN' }),
      line({ fourD: '3', name: 'SOON', startDate: '2026-09-20', endDate: '2026-09-22' }),
      line({ fourD: '3', name: 'SOON', reasonCategory: 'Off/Leave', startDate: '2026-09-22', endDate: '2026-09-22' }),
      line({ fourD: '5', name: 'CLINIC', reasonCategory: 'MA', endDate: '2026-09-22' }),
      line({ fourD: '4', name: 'STATUS', reasonCategory: 'Status', endDate: '2026-09-23' }),
    ]);
    const rows = returnsToDuty(personnel, DAY);
    expect(rows.map((row) => [row.name, row.backOn])).toEqual([
      ['SOON', '2026-09-23'],
      ['LATE', '2026-10-01'],
      ['OPEN', null],
    ]);
    expect(rows[0]?.from).toBe('2026-09-20');
  });
});

describe('awayAhead', () => {
  test('counts dated absences still running each day, and leaves open-ended ones out', () => {
    const returns = [
      { from: '2026-09-22', backOn: '2026-09-24' },
      { from: '2026-09-23', backOn: '2026-09-25' },
      { from: '2026-09-22', backOn: null },
    ] as ReturnRow[];
    expect(awayAhead(returns, DAY, 4)).toEqual({
      days: ['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'],
      away: [1, 2, 1, 0],
    });
  });
});
