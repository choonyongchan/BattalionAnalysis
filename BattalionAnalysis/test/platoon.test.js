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
import { platoonCoverage, platoonOf } from '../src/model/platoon.js';
import { UNASSIGNED } from '../src/model/domain.js';

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
