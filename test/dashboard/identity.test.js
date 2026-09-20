/**
 * Tests for resolving a soldier to a stable key.
 *
 * The case worth having is the fallback: 14% of personnel rows carry no 4D, and if two
 * spellings of one commander's name produced two keys, his history would be split in half
 * on every leaderboard without anything looking wrong.
 */

import { describe, expect, test } from 'bun:test';
import { identityKey, identityOf, normaliseName } from '../../src/model/identity.js';

describe('normaliseName', () => {
  test('makes one soldier out of two spellings', () => {
    expect(normaliseName('NG JUN WEI, CALEB')).toBe(normaliseName('Ng Jun Wei  Caleb'));
  });

  test('a blank name normalises to an empty string, not to a key', () => {
    expect(normaliseName('')).toBe('');
    expect(normaliseName(null)).toBe('');
  });
});

describe('identityOf', () => {
  test('the 4D wins when a row has one', () => {
    expect(identityOf({ four_d: '1214', name: 'RYAN' })).toEqual({
      key: '4D:1214',
      source: 'four_d',
    });
  });

  test('a company-prefixed 4D keeps its prefix, so Cougar 1204 is not Archer 1204', () => {
    expect(identityOf({ four_d: 'C1204', name: 'FAEGAN' }).key).toBe('4D:C1204');
  });

  test('a row with no 4D falls back to the name, and says so', () => {
    expect(identityOf({ four_d: '', name: 'Marcus Tan' })).toEqual({
      key: 'NAME:MARCUS TAN',
      source: 'name',
    });
  });

  test('a row with neither yields no key rather than a shared empty one', () => {
    expect(identityOf({ four_d: '', name: '' })).toEqual({ key: '', source: 'none' });
  });
});

describe('identityKey', () => {
  test('builds the same key a personnel row would, from fields held separately', () => {
    expect(identityKey('1214', 'Ryan')).toBe(identityOf({ four_d: '1214', name: 'Ryan' }).key);
    expect(identityKey('', 'Marcus Tan')).toBe(
      identityOf({ four_d: '', name: 'Marcus Tan' }).key
    );
  });

  test('neither field present yields no key', () => {
    expect(identityKey('', '')).toBe('');
  });
});
