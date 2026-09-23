/**
 * Tests for inferring a platoon from the 4D when a row states none.
 *
 * The case worth having is disagreement: when a row states a platoon that the 4D
 * contradicts, the stated value must win, because Hercules and Cougar rows that do state
 * a platoon are the ground truth `four_d`-parsing is checked against. Equally important is
 * the negative space — a 4D whose leading platoon digit is out of range (0, 5-9) must not
 * be mistaken for a platoon, and must not crash the parser Sheets feeds a bare number into.
 */

import { describe, expect, test } from 'bun:test';
import { platoonCoverage, platoonOf, positionKey, toPositionCells } from '../../src/model/platoon.js';
import { UNASSIGNED } from '../../src/model/domain.js';

describe('platoonOf', () => {
  test('a stated platoon wins even when the 4D disagrees', () => {
    expect(platoonOf({ platoon: '2', four_d: 'C1204' })).toEqual({
      platoon: '2',
      inferred: false,
    });
  });

  test('a stated HQ platoon is kept as HQ', () => {
    expect(platoonOf({ platoon: 'HQ', four_d: '' })).toEqual({
      platoon: 'HQ',
      inferred: false,
    });
  });

  test('a stated platoon is normalised to the PLATOONS roll', () => {
    expect(platoonOf({ platoon: 'hq', four_d: '' }).platoon).toBe('HQ');
    expect(platoonOf({ platoon: ' 3 ', four_d: '' }).platoon).toBe('3');
  });

  test('no stated platoon infers from the leading 4D digit, Archer/Scorpion style', () => {
    expect(platoonOf({ platoon: '', four_d: '1214' })).toEqual({
      platoon: '1',
      inferred: true,
    });
    expect(platoonOf({ platoon: '', four_d: '3310' })).toEqual({
      platoon: '3',
      inferred: true,
    });
  });

  test('a single letter company prefix is skipped before reading the platoon digit', () => {
    expect(platoonOf({ platoon: '', four_d: 'C1204' })).toEqual({
      platoon: '1',
      inferred: true,
    });
    expect(platoonOf({ platoon: '', four_d: 'A3210' })).toEqual({
      platoon: '3',
      inferred: true,
    });
  });

  test('a lowercase letter prefix is read the same as uppercase', () => {
    expect(platoonOf({ platoon: '', four_d: 'c4301' })).toEqual({
      platoon: '4',
      inferred: true,
    });
  });

  test('a numeric 4D arriving as a JS number (Sheets style) still infers', () => {
    expect(platoonOf({ platoon: '', four_d: 1214 })).toEqual({
      platoon: '1',
      inferred: true,
    });
  });

  test('a leading digit of 0 or 5-9 is not a platoon', () => {
    expect(platoonOf({ platoon: '', four_d: '0123' })).toEqual({
      platoon: UNASSIGNED,
      inferred: false,
    });
    expect(platoonOf({ platoon: '', four_d: '5100' })).toEqual({
      platoon: UNASSIGNED,
      inferred: false,
    });
  });

  test('a blank 4D and blank platoon yields unassigned, not an inference', () => {
    expect(platoonOf({ platoon: '', four_d: '' })).toEqual({
      platoon: UNASSIGNED,
      inferred: false,
    });
  });

  test('an unparseable 4D yields unassigned rather than crashing', () => {
    expect(platoonOf({ platoon: '', four_d: 'XYZ' })).toEqual({
      platoon: UNASSIGNED,
      inferred: false,
    });
  });
});

describe('platoonCoverage', () => {
  test('splits rows into stated, inferred and unknown, with a 0..1 inferred share', () => {
    const rows = [
      { platoon: '2', four_d: 'C1204' },
      { platoon: '', four_d: '3310' },
      { platoon: '', four_d: '0123' },
      { platoon: '', four_d: '' },
    ];
    expect(platoonCoverage(rows)).toEqual({
      total: 4,
      stated: 1,
      inferred: 1,
      unknown: 2,
      inferredShare: 0.25,
    });
  });

  test('an empty row set has a zero share rather than dividing by zero', () => {
    expect(platoonCoverage([])).toEqual({
      total: 0,
      stated: 0,
      inferred: 0,
      unknown: 0,
      inferredShare: 0,
    });
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

describe('positionKey', () => {
  test('spells out what each position column means for every company', () => {
    const key = positionKey();
    expect(key.map((entry) => entry.column)).toEqual(['Coy HQ', '1st Pl', '2nd Pl', '3rd Pl', '4th Pl']);
    expect(key[1].units).toEqual([
      { company: 'Archer', platoon: '1' },
      { company: 'Braves', platoon: '4' },
      { company: 'Cougar', platoon: '7' },
      { company: 'Stallion', platoon: 'PNR' },
      { company: 'Hercules', platoon: 'SIG' },
    ]);
    expect(key[4].units).toEqual([{ company: 'Stallion', platoon: 'SIG' }]);
  });
});
