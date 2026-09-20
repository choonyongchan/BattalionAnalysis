/**
 * Tests for the training rotation schedule.
 *
 * This is a new concept nobody has validated in production yet, so the cases worth
 * having are the ones a commander would actually hit while setting the tab up: an
 * accidental swap of a rotation's start and end, two rotations that overlap and must
 * still resolve to one deterministic answer, and a few days that were simply never
 * assigned to anything.
 */

import { describe, expect, test } from 'bun:test';
import {
  rotationIssues,
  rotationOf,
  rotationSpan,
  toRotations,
} from '../../src/model/rotations.js';

describe('toRotations', () => {
  test('parses raw rows into sorted start/end triples', () => {
    expect(
      toRotations([
        { name: 'Rot 2', start_date: '2026-04-01', end_date: '2026-06-30' },
        { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
      ])
    ).toEqual([
      { name: 'TRADES', start: '2026-01-01', end: '2026-03-31' },
      { name: 'Rot 2', start: '2026-04-01', end: '2026-06-30' },
    ]);
  });

  test('a missing end date leaves the rotation open-ended', () => {
    expect(toRotations([{ name: 'Rot 4', start_date: '2026-10-01', end_date: '' }])).toEqual([
      { name: 'Rot 4', start: '2026-10-01', end: null },
    ]);
  });

  test('drops a row missing a name or an unparseable start date', () => {
    expect(toRotations([{ name: '', start_date: '2026-01-01', end_date: '2026-03-31' }])).toEqual([]);
    expect(toRotations([{ name: 'Rot 1', start_date: 'not a date', end_date: '2026-03-31' }])).toEqual([]);
  });

  test('an absent tab is an empty array, not a throw', () => {
    expect(toRotations([])).toEqual([]);
    expect(toRotations(undefined)).toEqual([]);
  });
});

describe('rotationOf', () => {
  const rotations = toRotations([
    { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
    { name: 'Rot 1', start_date: '2026-04-01', end_date: '2026-06-30' },
    { name: 'Rot 2', start_date: '2026-07-01', end_date: '' }, // open-ended
  ]);

  test('finds the rotation containing a date in its middle', () => {
    expect(rotationOf('2026-05-15', rotations)).toBe('Rot 1');
  });

  test('finds it on the first day of a rotation', () => {
    expect(rotationOf('2026-04-01', rotations)).toBe('Rot 1');
  });

  test('finds it on the last day of a rotation', () => {
    expect(rotationOf('2026-03-31', rotations)).toBe('TRADES');
  });

  test('returns null for a date covered by no rotation', () => {
    expect(rotationOf('2025-12-31', rotations)).toBe(null);
  });

  test('an open-ended rotation contains every date from its start onward', () => {
    expect(rotationOf('2026-07-01', rotations)).toBe('Rot 2');
    expect(rotationOf('2030-01-01', rotations)).toBe('Rot 2');
  });

  test('when rotations overlap, the earliest-starting match wins, deterministically', () => {
    const overlapping = toRotations([
      { name: 'Rot 3', start_date: '2026-08-15', end_date: '2026-09-15' },
      { name: 'Rot 2', start_date: '2026-08-01', end_date: '2026-08-31' },
    ]);
    expect(rotationOf('2026-08-20', overlapping)).toBe('Rot 2');
  });
});

describe('rotationIssues', () => {
  test('an empty schedule produces no issues, not a complaint about being empty', () => {
    expect(rotationIssues([])).toEqual([]);
  });

  test('flags an end date before its start as invalid', () => {
    const rotations = toRotations([{ name: 'Rot 2', start_date: '2026-06-01', end_date: '2026-05-01' }]);
    const issues = rotationIssues(rotations);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('invalid');
    expect(issues[0].message).toContain('Rot 2');
  });

  test('flags two overlapping rotations, naming both', () => {
    const rotations = toRotations([
      { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-04-15' },
      { name: 'Rot 1', start_date: '2026-04-01', end_date: '2026-06-30' },
    ]);
    const issues = rotationIssues(rotations);
    const overlap = issues.find((issue) => issue.kind === 'overlap');
    expect(overlap).toBeTruthy();
    expect(overlap.message).toContain('TRADES');
    expect(overlap.message).toContain('Rot 1');
  });

  test('flags a gap between consecutive rotations, naming both', () => {
    const rotations = toRotations([
      { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
      { name: 'Rot 1', start_date: '2026-04-10', end_date: '2026-06-30' },
    ]);
    const issues = rotationIssues(rotations);
    const gap = issues.find((issue) => issue.kind === 'gap');
    expect(gap).toBeTruthy();
    expect(gap.message).toContain('TRADES');
    expect(gap.message).toContain('Rot 1');
  });

  test('back-to-back rotations with no gap raise no gap issue', () => {
    const rotations = toRotations([
      { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
      { name: 'Rot 1', start_date: '2026-04-01', end_date: '2026-06-30' },
    ]);
    expect(rotationIssues(rotations).filter((issue) => issue.kind === 'gap')).toEqual([]);
  });

  test('an open-ended rotation raises no gap after it', () => {
    const rotations = toRotations([{ name: 'Rot 2', start_date: '2026-07-01', end_date: '' }]);
    expect(rotationIssues(rotations)).toEqual([]);
  });
});

describe('rotationSpan', () => {
  test('returns null for an empty schedule', () => {
    expect(rotationSpan([])).toBe(null);
  });

  test('spans from the earliest start to the latest end', () => {
    const rotations = toRotations([
      { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
      { name: 'Rot 1', start_date: '2026-04-01', end_date: '2026-06-30' },
    ]);
    expect(rotationSpan(rotations)).toEqual({ start: '2026-01-01', end: '2026-06-30' });
  });

  test('is open-ended when any rotation is open-ended', () => {
    const rotations = toRotations([
      { name: 'TRADES', start_date: '2026-01-01', end_date: '2026-03-31' },
      { name: 'Rot 4', start_date: '2026-10-01', end_date: '' },
    ]);
    expect(rotationSpan(rotations)).toEqual({ start: '2026-01-01', end: null });
  });
});
