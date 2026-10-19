/** Tests for the stored parade-state message vocabulary shared by the runner, the intake and the Deposit page. */

import { describe, expect, test } from 'bun:test';
import { isFirstParade, isLastParade, needsReviewError, outcomeOf, reasonsOf } from '../../shared/paradeMessage.ts';

describe('header markers', () => {
  test('a first parade is named in full, as FPS, or as a bare FP', () => {
    for (const header of ['ARCHER FIRST PARADE STATE', 'Archer FPS 220626', 'BRAVES COY FP']) expect(isFirstParade(header)).toBe(true);
  });

  test('a bare PARADE STATE or PS names no session', () => {
    expect(isFirstParade('COUGAR COMPANY PARADE STATE')).toBe(false);
    expect(isFirstParade('BRAVES COY PS')).toBe(false);
  });

  test('a last parade is named in full, as LPS, or as a bare LP', () => {
    for (const header of ['LAST PARADE STATE', 'Archer LPS', 'BRAVES COY LP']) expect(isLastParade(header)).toBe(true);
  });
});

describe('stored errors', () => {
  test('a doubted parse round-trips its lines', () => {
    const error = needsReviewError(['first', 'second']);
    expect(reasonsOf(error)).toEqual(['first', 'second']);
    expect(outcomeOf(error)).toEqual({ outcome: 'needs_review', problems: 2 });
  });

  test('a rejection is kept whole, and a parsed message has nothing', () => {
    expect(reasonsOf('Not a parade state.')).toEqual(['Not a parade state.']);
    expect(outcomeOf('Not a parade state.')).toEqual({ outcome: 'rejected', problems: 0 });
    expect(reasonsOf(null)).toEqual([]);
    expect(outcomeOf(null)).toEqual({ outcome: null, problems: 0 });
  });
});
