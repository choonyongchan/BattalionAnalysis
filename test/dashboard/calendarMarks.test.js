/**
 * Tests for weekend and public-holiday annotations on a time axis.
 *
 * The cases worth having are the ones that would otherwise draw a chart lying about why
 * a line dipped: two abutting weekend rectangles with a seam instead of one band, a
 * weekend clipped at the range's edge, and a Public Holidays tab that does not exist
 * throwing instead of degrading quietly.
 */

import { describe, expect, test } from 'bun:test';
import {
  holidayIsWeekend,
  holidaysIn,
  toHolidays,
  weekendBands,
} from '../../dashboard/src/model/calendarMarks.js';

describe('toHolidays', () => {
  test('parses raw rows into sorted date/name pairs', () => {
    expect(
      toHolidays([
        { date: '2026-08-09', name: 'National Day' },
        { date: '2026-01-01', name: "New Year's Day" },
      ])
    ).toEqual([
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-08-09', name: 'National Day' },
    ]);
  });

  test('drops a row with an unparseable date', () => {
    expect(toHolidays([{ date: 'not a date', name: 'Mystery Day' }])).toEqual([]);
  });

  test('a blank name on a known Singapore holiday resolves to its official name', () => {
    expect(toHolidays([{ date: '2026-08-09', name: '' }])).toEqual([
      { date: '2026-08-09', name: 'National Day' },
    ]);
  });

  test('a blank name on a date not in the Singapore map falls back to the generic label', () => {
    expect(toHolidays([{ date: '2026-08-11', name: '' }])).toEqual([
      { date: '2026-08-11', name: 'Public holiday' },
    ]);
  });

  test('a non-blank sheet name wins over the Singapore map for the same date', () => {
    expect(toHolidays([{ date: '2026-08-09', name: 'Battalion stand-down' }])).toEqual([
      { date: '2026-08-09', name: 'Battalion stand-down' },
    ]);
  });

  test('an absent tab is an empty array, not a throw', () => {
    expect(toHolidays([])).toEqual([]);
    expect(toHolidays(undefined)).toEqual([]);
  });
});

describe('holidaysIn', () => {
  const holidays = toHolidays([
    { date: '2026-08-09', name: 'National Day' },
    { date: '2026-12-25', name: 'Christmas Day' },
  ]);

  test('keeps a holiday inside the range, inclusive of both ends', () => {
    expect(holidaysIn(holidays, '2026-08-09', '2026-08-09')).toEqual([
      { date: '2026-08-09', name: 'National Day' },
    ]);
  });

  test('excludes a holiday outside the range', () => {
    expect(holidaysIn(holidays, '2026-01-01', '2026-06-30')).toEqual([]);
  });
});

describe('weekendBands', () => {
  test('collapses a Saturday-Sunday pair into one band, not two', () => {
    // 2026-06-27 is a Saturday, 2026-06-28 the Sunday after it.
    expect(weekendBands('2026-06-22', '2026-06-28')).toEqual([{ from: '2026-06-27', to: '2026-06-28' }]);
  });

  test('a range starting mid-weekend yields a one-day band', () => {
    expect(weekendBands('2026-06-28', '2026-06-30')).toEqual([{ from: '2026-06-28', to: '2026-06-28' }]);
  });

  test('a range ending on a Saturday yields a one-day band', () => {
    expect(weekendBands('2026-06-24', '2026-06-27')).toEqual([{ from: '2026-06-27', to: '2026-06-27' }]);
  });

  test('a range with no weekend at all yields no bands', () => {
    expect(weekendBands('2026-06-22', '2026-06-26')).toEqual([]);
  });

  test('two separate weekends yield two separate bands', () => {
    const bands = weekendBands('2026-06-22', '2026-07-05');
    expect(bands).toEqual([
      { from: '2026-06-27', to: '2026-06-28' },
      { from: '2026-07-04', to: '2026-07-05' },
    ]);
  });
});

describe('holidayIsWeekend', () => {
  test('flags a holiday that falls on a Saturday or Sunday', () => {
    expect(holidayIsWeekend({ date: '2026-06-27', name: 'Some Saturday holiday' })).toBe(true);
    expect(holidayIsWeekend({ date: '2026-06-22', name: 'Some Monday holiday' })).toBe(false);
  });
});
