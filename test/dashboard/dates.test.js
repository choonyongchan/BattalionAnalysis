/**
 * Tests for ISO date arithmetic.
 *
 * These run in UTC deliberately. A viewer west of Singapore must read a parade state
 * dated the 22nd as the 22nd, and the only way that holds is if none of this arithmetic
 * touches local time.
 */

import { describe, expect, test } from 'bun:test';
import {
  addDays,
  inclusiveDaySpan,
  isWeekend,
  weekdayOf,
} from '../../src/model/dates.js';

describe('day arithmetic', () => {
  test('a one-day absence spans one day, not zero', () => {
    expect(inclusiveDaySpan('2026-06-22', '2026-06-22')).toBe(1);
    expect(inclusiveDaySpan('2026-06-20', '2026-06-23')).toBe(4);
  });

  test('an end before its start stays negative rather than wrapping', () => {
    expect(inclusiveDaySpan('2026-06-23', '2026-06-20')).toBeLessThan(0);
  });

  test('day arithmetic crosses a month boundary correctly', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
  });

  test('day arithmetic crosses a year boundary correctly', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('weekdays', () => {
  test('weekdays are Monday-first, so Monday and Friday sit at the ends', () => {
    expect(weekdayOf('2026-06-22')).toEqual({ index: 0, name: 'Mon' });
    expect(weekdayOf('2026-06-26')).toEqual({ index: 4, name: 'Fri' });
    expect(weekdayOf('2026-06-28')).toEqual({ index: 6, name: 'Sun' });
  });

  test('only Saturday and Sunday are weekend', () => {
    expect(isWeekend('2026-06-26')).toBe(false);
    expect(isWeekend('2026-06-27')).toBe(true);
    expect(isWeekend('2026-06-28')).toBe(true);
    expect(isWeekend('2026-06-29')).toBe(false);
  });
});
