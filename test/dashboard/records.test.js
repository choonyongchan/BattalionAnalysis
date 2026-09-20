/**
 * Tests for turning a tab's raw values into typed records.
 *
 * The cases worth having are the ones that would otherwise fail silently: a renamed
 * column read as the wrong field, and a short row read as missing data.
 */

import { describe, expect, test } from 'bun:test';
import { indexHeaders, toRecords } from '../../src/data/records.js';

describe('header resolution', () => {
  test('resolves columns by name, not position', () => {
    const index = indexHeaders(['session', 'date', 'company'], ['date', 'company'], 'Tab');
    expect(index.date).toBe(1);
    expect(index.company).toBe(2);
  });

  test('a missing column throws, naming the tab and the column', () => {
    expect(() => indexHeaders(['date'], ['date', 'reason'], 'Personnel Data')).toThrow(
      /Personnel Data.*"reason"/
    );
  });

  test('the error names every missing column at once', () => {
    expect(() => indexHeaders([], ['date', 'reason'], 'Personnel Data')).toThrow(
      /columns "date", "reason"/
    );
  });

  test('surrounding whitespace in a header does not hide it', () => {
    expect(indexHeaders(['  date  '], ['date'], 'Tab').date).toBe(0);
  });
});

describe('record mapping', () => {
  test('maps rows to objects keyed by header', () => {
    const values = [
      ['date', 'company'],
      ['2026-06-22', 'Cougar'],
    ];
    expect(toRecords(values, ['date', 'company'], 'Tab')).toEqual([
      { date: '2026-06-22', company: 'Cougar' },
    ]);
  });

  test('a row the API truncated reads as blank, not as an error', () => {
    const values = [
      ['date', 'company', 'reason'],
      ['2026-06-22'],
    ];
    expect(toRecords(values, ['date', 'reason'], 'Tab')).toEqual([
      { date: '2026-06-22', reason: '' },
    ]);
  });

  test('an empty tab yields no records', () => {
    expect(toRecords([], ['date'], 'Tab')).toEqual([]);
  });
});
