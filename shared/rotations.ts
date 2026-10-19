/** Training rotations (TRADES, Rot 1-4) from the Settings calendar; ISO dates compare correctly as strings. */

import { addDays } from './dates.ts';

/** One rotation; `start` and `end` are inclusive `yyyy-MM-dd`. */
export interface Rotation {
  name: string;
  start: string;
  end: string;
}

/** A problem a commander can fix on the Settings page. */
export interface RotationIssue {
  kind: 'overlap' | 'gap' | 'invalid';
  message: string;
}

const byStart = (a: Rotation, b: Rotation): number => a.start.localeCompare(b.start);

/** Whether two rotations share a day. */
function overlaps(a: Rotation, b: Rotation): boolean {
  return a.start <= b.end && b.start <= a.end;
}

/** Name of the rotation containing a date (earliest start wins an overlap), or null. */
export function rotationOf(isoDate: string, rotations: Rotation[]): string | null {
  const match = rotations
    .filter((rotation) => rotation.start <= isoDate && isoDate <= rotation.end)
    .sort(byStart)[0];
  return match ? match.name : null;
}

/** Reversed dates, overlaps and uncovered days in a schedule, each as a fix-it sentence. */
export function rotationIssues(rotations: Rotation[]): RotationIssue[] {
  const issues: RotationIssue[] = rotations
    .filter((rotation) => rotation.end < rotation.start)
    .map((rotation) => ({
      kind: 'invalid',
      message: `${rotation.name} ends (${rotation.end}) before it starts (${rotation.start}); fix its start or end date.`,
    }));
  const sorted = rotations.filter((rotation) => rotation.end >= rotation.start).sort(byStart);
  sorted.forEach((current, i) => {
    sorted.slice(i + 1).forEach((later) => {
      if (overlaps(current, later)) {
        issues.push({
          kind: 'overlap',
          message: `${current.name} and ${later.name} overlap; adjust their start or end dates so only one rotation covers each day.`,
        });
      }
    });
  });
  sorted.slice(0, -1).forEach((current, i) => {
    const next = sorted[i + 1]!;
    const gapStart = addDays(current.end, 1);
    if (!overlaps(current, next) && gapStart < next.start) {
      issues.push({
        kind: 'gap',
        message: `${gapStart} to ${addDays(next.start, -1)} belongs to no rotation, between ${current.name} and ${next.name}; add a rotation covering those days.`,
      });
    }
  });
  return issues;
}
