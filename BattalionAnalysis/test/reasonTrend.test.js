/**
 * Tests for tracking the top reasons across time buckets.
 *
 * The case worth having is the fold: once a label drops out of the top N it must not
 * vanish, or a chart would silently undercount its own total. It joins "Other" instead,
 * and "Other" is absent entirely when nothing was folded — a legend entry with a
 * permanent zero is worse than no entry.
 */

import { describe, expect, test } from 'bun:test';
import { OTHER_LABEL, topLabelsOverTime } from '../src/model/reasonTrend.js';

describe('topLabelsOverTime', () => {
  test('ranks labels by total count and tracks only the top N', () => {
    const items = [
      { date: '2026-07-20', labels: ['Fever'] },
      { date: '2026-07-20', labels: ['Fever'] },
      { date: '2026-07-21', labels: ['Cough'] },
    ];
    const result = topLabelsOverTime(items, 'daily', [], 1);
    expect(result.series.map((s) => s.name)).toEqual(['Fever', OTHER_LABEL]);
  });

  test('a row with no label still holds its day on the axis, with every series at zero', () => {
    // Dropping the day would turn "nothing was classified" into "nothing happened", which
    // is a different and false claim about that date.
    const items = [{ date: '2026-07-20', labels: [] }, { date: '2026-07-21', labels: ['Fever'] }];
    const result = topLabelsOverTime(items, 'daily', [], 5);
    expect(result.categories).toHaveLength(2);
    const fever = result.series.find((s) => s.name === 'Fever');
    expect(fever.values[0]).toBe(0);
    expect(fever.values[1]).toBe(1);
  });

  test('a row with no date at all is dropped entirely', () => {
    const items = [{ date: null, labels: ['Fever'] }, { date: '2026-07-21', labels: ['Fever'] }];
    const result = topLabelsOverTime(items, 'daily', [], 5);
    expect(result.categories).toHaveLength(1);
  });

  test('no fold occurs and Other is entirely absent when everything fits in topN', () => {
    const items = [{ date: '2026-07-20', labels: ['Fever'] }, { date: '2026-07-20', labels: ['Cough'] }];
    const result = topLabelsOverTime(items, 'daily', [], 5);
    expect(result.series.map((s) => s.name)).not.toContain(OTHER_LABEL);
  });

  test('a multi-label row counts once per label, not once per row', () => {
    const items = [{ date: '2026-07-20', labels: ['Fever', 'Cough'] }];
    const result = topLabelsOverTime(items, 'daily', [], 5);
    const fever = result.series.find((s) => s.name === 'Fever');
    const cough = result.series.find((s) => s.name === 'Cough');
    expect(fever.values[0]).toBe(1);
    expect(cough.values[0]).toBe(1);
  });

  test('categories are in chronological order, whatever order the items arrived in', () => {
    const items = [
      { date: '2026-07-22', labels: ['Fever'] },
      { date: '2026-07-20', labels: ['Fever'] },
      { date: '2026-07-21', labels: ['Fever'] },
    ];
    const result = topLabelsOverTime(items, 'daily', [], 5);
    expect(result.categories).toEqual(['Mon 20 Jul', 'Tue 21 Jul', 'Wed 22 Jul']);
  });

  test('an empty item list produces an empty chart, not a crash', () => {
    const result = topLabelsOverTime([], 'daily', [], 5);
    expect(result.categories).toEqual([]);
    expect(result.series).toEqual([]);
  });
});
