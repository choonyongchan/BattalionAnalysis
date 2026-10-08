/**
 * Tests for resolving a platoon from the sub-header a soldier's line sits under.
 *
 * The sub-header is checked against the soldier's own company: Cougar has a `8`, Archer
 * does not. The 4D is read but, while `USE_FOURD_PLATOON` is off, never decides a platoon.
 */

import { describe, expect, test } from 'bun:test';
import { platoonCoverage, platoonOf, toPositionCells } from '../../frontend/src/model/platoon.js';
import { UNASSIGNED } from '../../shared/domain.js';

describe('platoonOf', () => {
  test("a sub-header the company has is the platoon, named as the company names it", () => {
    expect(platoonOf({ company: 'Cougar', platoon: '8', four_d: '' }).platoon).toBe('8');
    expect(platoonOf({ company: 'Hercules', platoon: 'sig', four_d: '' }).platoon).toBe('SIG');
    expect(platoonOf({ company: 'Hercules', platoon: 'OPR+ASA', four_d: '' }).platoon).toBe('OPR+ASA');
    expect(platoonOf({ company: 'Archer', platoon: ' hq ', four_d: '' }).platoon).toBe('HQ');
  });

  test("a sub-header the company does not have is Unassigned", () => {
    expect(platoonOf({ company: 'Archer', platoon: '5', four_d: '' }).platoon).toBe(UNASSIGNED);
    expect(platoonOf({ company: '', platoon: '1', four_d: '' }).platoon).toBe(UNASSIGNED);
  });

  test('the 4D is reported but never decides the platoon while switched off', () => {
    expect(platoonOf({ company: 'Archer', platoon: '', four_d: 'A3210' })).toEqual({
      platoon: UNASSIGNED,
      inferred: false,
      fourD: '3',
    });
    expect(platoonOf({ company: 'Archer', platoon: '2', four_d: '1204' })).toEqual({
      platoon: '2',
      inferred: false,
      fourD: '1',
    });
  });

  test('switched on, the 4D fills only a missing sub-header and is marked inferred', () => {
    expect(platoonOf({ company: 'Archer', platoon: '', four_d: 1214 }, true)).toEqual({
      platoon: '1',
      inferred: true,
      fourD: '1',
    });
    expect(platoonOf({ company: 'Archer', platoon: 'HQ', four_d: '1214' }, true).platoon).toBe('HQ');
    expect(platoonOf({ company: 'Archer', platoon: '', four_d: 'XYZ' }, true).platoon).toBe(UNASSIGNED);
  });
});

describe('platoonCoverage', () => {
  test('counts rows under a known sub-header, and stated rows whose 4D disagrees', () => {
    const rows = [
      { company: 'Archer', platoon: '2', four_d: '1204' },
      { company: 'Archer', platoon: '3', four_d: '3310' },
      { company: 'Cougar', platoon: '8', four_d: '' },
      { company: 'Archer', platoon: '', four_d: '3310' },
    ];
    expect(platoonCoverage(rows)).toEqual({ total: 4, stated: 3, unknown: 1, fourDDisagrees: 1 });
  });
});

describe('toPositionCells', () => {
  test("places each company's own platoon under its position column", () => {
    const { cells, unplaced } = toPositionCells([
      { row: 'Cougar', column: '8', value: 3 },
      { row: 'Stallion', column: 'SIG', value: 2 },
      { row: 'Hercules', column: 'OPR+ASA', value: 1 },
      { row: 'Braves', column: 'HQ', value: 4 },
    ]);
    expect(unplaced).toBe(0);
    expect(cells).toContainEqual({ row: 'Cougar', column: '2nd Pl', platoon: '8', value: 3, inferred: false });
    expect(cells).toContainEqual({ row: 'Stallion', column: '4th Pl', platoon: 'SIG', value: 2, inferred: false });
    expect(cells).toContainEqual({ row: 'Hercules', column: '2nd Pl', platoon: 'OPR+ASA', value: 1, inferred: false });
    expect(cells).toContainEqual({ row: 'Braves', column: 'Coy HQ', platoon: 'Coy HQ', value: 4, inferred: false });
  });

  test('every sub-unit gets a cell, zero included, and a company has no cell past its last', () => {
    const { cells } = toPositionCells([]);
    expect(cells.filter((cell) => cell.row === 'Archer').map((cell) => cell.platoon)).toEqual(['Coy HQ', '1', '2', '3']);
    expect(cells.find((cell) => cell.row === 'Archer' && cell.column === '4th Pl')).toBeUndefined();
    expect(cells.every((cell) => cell.value === 0)).toBe(true);
  });

  test("a platoon the company does not have is counted as unplaced, not drawn", () => {
    const { cells, unplaced } = toPositionCells([
      { row: 'Archer', column: '7', value: 2 },
      { row: 'Archer', column: UNASSIGNED, value: 1 },
    ]);
    expect(unplaced).toBe(3);
    expect(cells.every((cell) => cell.value === 0)).toBe(true);
  });
});
