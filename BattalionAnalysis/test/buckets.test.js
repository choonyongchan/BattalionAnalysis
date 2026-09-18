/**
 * Tests for the Daily / Weekly / Monthly / Rotational time grouping.
 *
 * The cases worth having are the ones that would silently misfile a date on a chart
 * axis: a Sunday landing in the wrong week, a month boundary crossing a year, and a
 * rotational grouping that still draws a chart when no rotation schedule exists at all.
 */

import { describe, expect, test } from 'bun:test';
import {
  GRANULARITIES,
  bucketOf,
  groupDates,
} from '../src/model/buckets.js';
import { toRotations } from '../src/model/rotations.js';

describe('GRANULARITIES', () => {
  test('lists the radio options in display order', () => {
    expect(GRANULARITIES).toEqual([
      { name: 'daily', label: 'Daily' },
      { name: 'weekly', label: 'Weekly' },
      { name: 'monthly', label: 'Monthly' },
      { name: 'rotational', label: 'Rotational' },
    ]);
  });
});

describe('bucketOf daily', () => {
  test('keys on the ISO date and labels it weekday-day-month', () => {
    // 2026-07-20 is a Monday.
    expect(bucketOf('2026-07-20', 'daily', [])).toEqual({ key: '2026-07-20', label: 'Mon 20 Jul' });
  });
});

describe('bucketOf weekly', () => {
  test('a Sunday buckets with the Monday before it, not the Monday after', () => {
    // 2026-07-19 is a Sunday; the week it belongs to started Monday 2026-07-13.
    const sunday = bucketOf('2026-07-19', 'weekly', []);
    const mondayBefore = bucketOf('2026-07-13', 'weekly', []);
    expect(sunday.key).toBe('2026-07-13');
    expect(sunday).toEqual(mondayBefore);
  });

  test('labels the bucket by its Monday', () => {
    expect(bucketOf('2026-07-20', 'weekly', [])).toEqual({ key: '2026-07-20', label: 'Week of 20 Jul' });
  });
});

describe('bucketOf monthly', () => {
  test('keys on yyyy-MM and crosses a year boundary correctly', () => {
    expect(bucketOf('2026-12-31', 'monthly', [])).toEqual({ key: '2026-12', label: 'Dec 2026' });
    expect(bucketOf('2027-01-01', 'monthly', [])).toEqual({ key: '2027-01', label: 'Jan 2027' });
  });
});

describe('bucketOf rotational', () => {
  const rotations = toRotations([
    { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
    { name: 'Rot 1', start_date: '2026-04-01', end_date: '2026-06-30' },
  ]);

  test('keys on the rotation start date and labels it with the rotation name', () => {
    expect(bucketOf('2026-05-15', 'rotational', rotations)).toEqual({
      key: '2026-04-01',
      label: 'Rot 1',
    });
  });

  test('a date in no rotation buckets under a last-sorting key labelled No rotation', () => {
    const bucket = bucketOf('2025-06-01', 'rotational', rotations);
    expect(bucket.label).toBe('No rotation');
    expect(bucket.key > '2026-06-30').toBe(true);
  });

  test('with no rotations configured at all, everything falls into No rotation', () => {
    expect(bucketOf('2026-05-15', 'rotational', [])).toEqual(
      bucketOf('2025-06-01', 'rotational', [])
    );
    expect(bucketOf('2026-05-15', 'rotational', []).label).toBe('No rotation');
  });

  test('rotational keys sort chronologically as plain strings', () => {
    const keys = [
      bucketOf('2026-05-15', 'rotational', rotations).key, // Rot 1, starts 2026-04-01
      bucketOf('2026-02-01', 'rotational', rotations).key, // TRADES, starts 2026-01-01
      bucketOf('2025-06-01', 'rotational', rotations).key, // No rotation, sorts last
    ];
    const sorted = keys.slice().sort();
    expect(sorted).toEqual([
      bucketOf('2026-02-01', 'rotational', rotations).key,
      bucketOf('2026-05-15', 'rotational', rotations).key,
      bucketOf('2025-06-01', 'rotational', rotations).key,
    ]);
  });
});

describe('groupDates', () => {
  test('groups and orders buckets chronologically', () => {
    // 13 and 14 Jul are the Monday and Tuesday of one week; 21 Jul is the Tuesday of the
    // next. Two buckets, in date order, whatever order the dates arrived in.
    const dates = ['2026-07-21', '2026-07-13', '2026-07-14'];
    expect(groupDates(dates, 'weekly', [])).toEqual([
      { key: '2026-07-13', label: 'Week of 13 Jul', dates: ['2026-07-13', '2026-07-14'] },
      { key: '2026-07-20', label: 'Week of 20 Jul', dates: ['2026-07-21'] },
    ]);
  });

  test('an empty date list yields no buckets', () => {
    expect(groupDates([], 'daily', [])).toEqual([]);
  });

  test('rotational grouping with no rotations still draws one No-rotation bucket', () => {
    const groups = groupDates(['2026-01-05', '2026-01-06'], 'rotational', []);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('No rotation');
    expect(groups[0].dates).toEqual(['2026-01-05', '2026-01-06']);
  });

  test('monthly grouping across a year boundary produces two ordered buckets', () => {
    const groups = groupDates(['2027-01-05', '2026-12-20', '2026-12-31'], 'monthly', []);
    expect(groups.map((g) => g.key)).toEqual(['2026-12', '2027-01']);
  });
});
