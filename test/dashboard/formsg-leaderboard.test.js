/**
 * Tests for the FormSG-side "reported sick" leaderboard.
 *
 * The case worth having is the one requirement 3.7 runs into: FormSG's "Unit & Coy"
 * answer names a company but never a platoon, so a platoon-level ranking of reported
 * sick is not data this dashboard has — these tests pin the company-only shape rather
 * than letting a future edit quietly invent a platoon column with nothing behind it.
 */

import { describe, expect, test } from 'bun:test';
import { toSubmissions, topSubmitters } from '../../src/model/formsg.js';

/**
 * A FormSG response row, as `toSubmissions` reads it.
 * @param {!Object} overrides Fields to set or replace.
 * @returns {!Object} A row with sane defaults.
 */
function row(overrides) {
  return {
    Timestamp: '2026-07-20 08:00:00',
    RANK: 'REC',
    '[Myinfo] Name': 'TAN JUN HAO',
    '4D Number (REC Only)': '3203',
    'Unit & Coy': '40 SAR / Cougar',
    'Report Sick Type': 'Report Sick In-Camp (RSI)',
    ...overrides,
  };
}

describe('topSubmitters', () => {
  test('ranks by submission count, ties broken by name', () => {
    const submissions = toSubmissions([
      row({ '4D Number (REC Only)': '1101', '[Myinfo] Name': 'ZED' }),
      row({ '4D Number (REC Only)': '1101', '[Myinfo] Name': 'ZED' }),
      row({ '4D Number (REC Only)': '1102', '[Myinfo] Name': 'ADA' }),
    ]);
    const top = topSubmitters(submissions, 10);
    expect(top[0].name).toBe('ZED');
    expect(top[0].count).toBe(2);
    expect(top).toHaveLength(2);
  });

  test('carries no platoon field at all', () => {
    const submissions = toSubmissions([row({})]);
    expect(topSubmitters(submissions, 10)[0].platoon).toBeUndefined();
  });
});
