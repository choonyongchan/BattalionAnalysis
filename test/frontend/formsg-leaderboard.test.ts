/** Tests for the FormSG "reported sick" leaderboard, which has no platoon: the form never asks for one. */

import { describe, expect, test } from 'bun:test';
import { topSubmitters } from '../../frontend/src/model/formsg.ts';
import type { ReportSickRow } from '../../shared/dashboard.ts';
import { submissionsOf } from './fixtures.ts';

/** A FormSG row with sane defaults. */
function row(overrides: Partial<ReportSickRow>): Partial<ReportSickRow> {
  return {
    timestamp: '2026-07-20T08:00:00',
    rank: 'REC',
    name: 'TAN JUN HAO',
    fourD: '3203',
    unitCoy: '40 SAR / Cougar',
    company: 'Cougar',
    reportSickType: 'RSI',
    ...overrides,
  };
}

describe('topSubmitters', () => {
  test('ranks by submission count, ties broken by name', () => {
    const submissions = submissionsOf([
      row({ fourD: '1101', name: 'ZED' }),
      row({ fourD: '1101', name: 'ZED' }),
      row({ fourD: '1102', name: 'ADA' }),
    ]);
    const top = topSubmitters(submissions, 10);
    expect(top[0]?.name).toBe('ZED');
    expect(top[0]?.count).toBe(2);
    expect(top).toHaveLength(2);
  });

  test('carries no platoon field at all', () => {
    const submissions = submissionsOf([row({})]);
    expect(topSubmitters(submissions, 10)[0]).not.toHaveProperty('platoon');
  });
});
