/**
 * Tests for the dashboard's date-range filtering helpers.
 *
 * The cases worth having are the ones that would silently show the wrong slice: an
 * open bound read as a closed one, an episode that straddles the window's edge, and a
 * preset that miscounts across a month boundary.
 */

import { describe, expect, test } from 'bun:test';
import {
  PRESETS,
  addMonths,
  daysOfMonth,
  eachDay,
  firstOfMonth,
  matchPreset,
  overlapsRange,
  resolvePreset,
  withinRange,
} from '../../src/model/dateRange.js';

describe('withinRange', () => {
  test('is inclusive of both ends', () => {
    expect(withinRange('2026-06-01', '2026-06-01', '2026-06-30')).toBe(true);
    expect(withinRange('2026-06-30', '2026-06-01', '2026-06-30')).toBe(true);
  });

  test('excludes dates outside the range', () => {
    expect(withinRange('2026-05-31', '2026-06-01', '2026-06-30')).toBe(false);
    expect(withinRange('2026-07-01', '2026-06-01', '2026-06-30')).toBe(false);
  });

  test('a null bound is open', () => {
    expect(withinRange('2020-01-01', null, '2026-06-30')).toBe(true);
    expect(withinRange('2099-01-01', '2026-06-01', null)).toBe(true);
    expect(withinRange('2026-06-15', null, null)).toBe(true);
  });

  test('a missing date is never in range', () => {
    expect(withinRange(null, null, null)).toBe(false);
    expect(withinRange('', '2026-06-01', '2026-06-30')).toBe(false);
  });
});

describe('overlapsRange', () => {
  test('a span straddling the lower edge overlaps', () => {
    expect(overlapsRange('2026-05-28', '2026-06-03', '2026-06-01', '2026-06-30')).toBe(true);
  });

  test('a span straddling the upper edge overlaps', () => {
    expect(overlapsRange('2026-06-28', '2026-07-05', '2026-06-01', '2026-06-30')).toBe(true);
  });

  test('a span entirely before or after does not overlap', () => {
    expect(overlapsRange('2026-04-01', '2026-04-10', '2026-06-01', '2026-06-30')).toBe(false);
    expect(overlapsRange('2026-08-01', '2026-08-10', '2026-06-01', '2026-06-30')).toBe(false);
  });

  test('touching an edge by a single day still overlaps', () => {
    expect(overlapsRange('2026-05-01', '2026-06-01', '2026-06-01', '2026-06-30')).toBe(true);
    expect(overlapsRange('2026-06-30', '2026-07-30', '2026-06-01', '2026-06-30')).toBe(true);
  });

  test('null range bounds are open', () => {
    expect(overlapsRange('2020-01-01', '2020-01-02', null, null)).toBe(true);
  });

  test('a one-day span (start equals end) is handled', () => {
    expect(overlapsRange('2026-06-15', '2026-06-15', '2026-06-01', '2026-06-30')).toBe(true);
    expect(overlapsRange('2026-07-15', '2026-07-15', '2026-06-01', '2026-06-30')).toBe(false);
  });
});

describe('eachDay', () => {
  test('lists every day inclusive of both ends', () => {
    expect(eachDay('2026-06-01', '2026-06-04')).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
    ]);
  });

  test('a single-day range is just that day', () => {
    expect(eachDay('2026-06-15', '2026-06-15')).toEqual(['2026-06-15']);
  });

  test('returns nothing when the end precedes the start or a bound is missing', () => {
    expect(eachDay('2026-06-15', '2026-06-14')).toEqual([]);
    expect(eachDay(null, '2026-06-14')).toEqual([]);
    expect(eachDay('2026-06-01', null)).toEqual([]);
  });

  test('crosses a month boundary with the right length and endpoints', () => {
    const days = eachDay('2026-06-28', '2026-07-02');
    expect(days).toHaveLength(5);
    expect(days[0]).toBe('2026-06-28');
    expect(days[4]).toBe('2026-07-02');
  });
});

describe('resolvePreset', () => {
  test('thisMonth runs from the first of the current month to today', () => {
    expect(resolvePreset('thisMonth', '2026-06-22')).toEqual({ from: '2026-06-01', to: '2026-06-22' });
  });

  test('all clears both bounds', () => {
    expect(resolvePreset('all', '2026-06-22')).toEqual({ from: null, to: null });
  });

  test('an unknown name falls back to all', () => {
    expect(resolvePreset('nonsense', '2026-06-22')).toEqual({ from: null, to: null });
  });

  test('thisWeek runs Monday through today, not through Sunday, when today is a Monday', () => {
    // 2026-06-22 is itself a Monday, so the week has not started until today.
    expect(resolvePreset('thisWeek', '2026-06-22')).toEqual({ from: '2026-06-22', to: '2026-06-22' });
  });

  test('thisWeek runs Monday through today when today is a Sunday', () => {
    // 2026-06-28 is a Sunday: the full Mon-Sun week so far, not projected past today.
    expect(resolvePreset('thisWeek', '2026-06-28')).toEqual({ from: '2026-06-22', to: '2026-06-28' });
  });

  test('lastWeek is the full Monday-Sunday before this week, across a month boundary', () => {
    // 2026-07-03 is a Friday in the week of Mon 29 Jun; last week is Mon 22 Jun - Sun 28 Jun.
    expect(resolvePreset('lastWeek', '2026-07-03')).toEqual({ from: '2026-06-22', to: '2026-06-28' });
  });

  test('thisMonth on the 1st is a single day, not the whole month', () => {
    expect(resolvePreset('thisMonth', '2026-06-01')).toEqual({ from: '2026-06-01', to: '2026-06-01' });
  });

  test('lastMonth spans January across a year boundary', () => {
    expect(resolvePreset('lastMonth', '2026-02-15')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  test('lastMonth spans a 28-day February', () => {
    expect(resolvePreset('lastMonth', '2026-03-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  test('lastMonth spans a 29-day leap February', () => {
    expect(resolvePreset('lastMonth', '2024-03-10')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});

describe('PRESETS', () => {
  test('lists the quick-range buttons in display order', () => {
    expect(PRESETS.map((preset) => preset.name)).toEqual([
      'thisWeek',
      'lastWeek',
      'thisMonth',
      'lastMonth',
      'all',
    ]);
    expect(PRESETS.map((preset) => preset.label)).toEqual([
      'This week',
      'Last week',
      'This month',
      'Last month',
      'All',
    ]);
  });
});

describe('month-grid arithmetic', () => {
  test('firstOfMonth snaps any day to the first', () => {
    expect(firstOfMonth('2026-06-22')).toBe('2026-06-01');
  });

  test('addMonths crosses year boundaries both ways', () => {
    expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
    expect(addMonths('2026-06-01', -18)).toBe('2024-12-01');
  });

  test('daysOfMonth handles a leap February', () => {
    expect(daysOfMonth('2024-02-01')).toHaveLength(29);
    expect(daysOfMonth('2026-02-01')).toHaveLength(28);
    expect(daysOfMonth('2026-06-01')[0]).toBe('2026-06-01');
    expect(daysOfMonth('2026-06-01')[29]).toBe('2026-06-30');
  });
});

describe('matchPreset', () => {
  test('recognises the range a preset produced', () => {
    expect(matchPreset(null, null, '2026-06-22')).toBe('all');
  });

  test('recognises a thisMonth-shaped range', () => {
    expect(matchPreset('2026-06-01', '2026-06-22', '2026-06-22')).toBe('thisMonth');
  });

  test('recognises a thisWeek-shaped range', () => {
    expect(matchPreset('2026-06-22', '2026-06-24', '2026-06-24')).toBe('thisWeek');
  });

  test('recognises a lastWeek-shaped range', () => {
    expect(matchPreset('2026-06-15', '2026-06-21', '2026-06-24')).toBe('lastWeek');
  });

  test('recognises a lastMonth-shaped range', () => {
    expect(matchPreset('2026-05-01', '2026-05-31', '2026-06-24')).toBe('lastMonth');
  });

  test('returns null for a hand-picked span that matches no preset', () => {
    expect(matchPreset('2026-06-10', '2026-06-18', '2026-06-22')).toBe(null);
  });
});
