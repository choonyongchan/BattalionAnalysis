/** Tests for weekend bands and public-holiday lines on a time axis. */

import { describe, expect, test } from 'bun:test';
import { holidaysIn, weekendBands } from '../../frontend/src/model/calendarMarks.ts';

describe('holidaysIn', () => {
  const holidays = [
    { date: '2026-08-09', name: 'National Day' },
    { date: '2026-12-25', name: 'Christmas Day' },
  ];

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
