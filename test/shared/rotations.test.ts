/** Tests for the training rotation schedule: lookups, overlaps, gaps and swapped dates. */

import { describe, expect, test } from 'bun:test';
import { rotationIssues, rotationOf, type Rotation } from '../../shared/rotations.ts';

const rotation = (name: string, start: string, end: string): Rotation => ({ name, start, end });

describe('rotationOf', () => {
  const rotations = [
    rotation('TRADES', '2026-01-01', '2026-03-31'),
    rotation('Rot 1', '2026-04-01', '2026-06-30'),
    rotation('Rot 2', '2026-07-01', '2026-09-30'),
  ];

  test('finds the rotation containing a date in its middle', () => {
    expect(rotationOf('2026-05-15', rotations)).toBe('Rot 1');
  });

  test('includes the first and last day of a rotation', () => {
    expect(rotationOf('2026-04-01', rotations)).toBe('Rot 1');
    expect(rotationOf('2026-03-31', rotations)).toBe('TRADES');
  });

  test('returns null for a date covered by no rotation', () => {
    expect(rotationOf('2025-12-31', rotations)).toBe(null);
    expect(rotationOf('2026-10-01', rotations)).toBe(null);
  });

  test('when rotations overlap, the earliest-starting match wins, whatever the list order', () => {
    const overlapping = [rotation('Rot 3', '2026-08-15', '2026-09-15'), rotation('Rot 2', '2026-08-01', '2026-08-31')];
    expect(rotationOf('2026-08-20', overlapping)).toBe('Rot 2');
  });
});

describe('rotationIssues', () => {
  test('an empty schedule produces no issues', () => {
    expect(rotationIssues([])).toEqual([]);
  });

  test('flags an end date before its start as invalid', () => {
    const issues = rotationIssues([rotation('Rot 2', '2026-06-01', '2026-05-01')]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.kind).toBe('invalid');
    expect(issues[0]!.message).toContain('Rot 2');
  });

  test('flags two overlapping rotations, naming both', () => {
    const issues = rotationIssues([rotation('TRADES', '2026-01-01', '2026-04-15'), rotation('Rot 1', '2026-04-01', '2026-06-30')]);
    const overlap = issues.find((issue) => issue.kind === 'overlap');
    expect(overlap?.message).toContain('TRADES');
    expect(overlap?.message).toContain('Rot 1');
  });

  test('flags a gap between consecutive rotations, naming both', () => {
    const issues = rotationIssues([rotation('TRADES', '2026-01-01', '2026-03-31'), rotation('Rot 1', '2026-04-10', '2026-06-30')]);
    const gap = issues.find((issue) => issue.kind === 'gap');
    expect(gap?.message).toContain('2026-04-01 to 2026-04-09');
    expect(gap?.message).toContain('TRADES');
    expect(gap?.message).toContain('Rot 1');
  });

  test('back-to-back rotations raise no issue', () => {
    expect(rotationIssues([rotation('TRADES', '2026-01-01', '2026-03-31'), rotation('Rot 1', '2026-04-01', '2026-06-30')])).toEqual([]);
  });
});
