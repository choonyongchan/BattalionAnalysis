/**
 * Tests for when each company filed its parade state.
 *
 * The chart this feeds exists to show who is *missing*, so the risk worth covering is a
 * silent drop: a company that never filed must still appear (with `filed:false`), a
 * double filing must resolve to the later timestamp rather than being double-counted, and
 * a malformed id must be visible on the Settings page rather than silently discarded.
 */

import { describe, expect, test } from 'bun:test';
import { filingsOn, latestFilingPerCompany, toFilings } from '../../src/model/submissions.js';
import { COMPANIES } from '../../src/model/domain.js';

/**
 * A "Parade State Responses" row, as the feed projects it.
 * @param {!Object} overrides Fields to set or replace.
 * @returns {!Object} A row with sane defaults.
 */
function row(overrides) {
  return {
    Timestamp: '2026-07-22T07:12:00',
    parade_response_id: 'Archer_2026-07-22_FPS',
    ...overrides,
  };
}

describe('toFilings', () => {
  test('parses company, date and session from the id, and clock time from the timestamp', () => {
    const [filing] = toFilings([row({})]);
    expect(filing).toEqual({
      company: 'Archer',
      date: '2026-07-22',
      session: 'FPS',
      at: { hour: 7, minute: 12, minutes: 432 },
      id: 'Archer_2026-07-22_FPS',
    });
  });

  test('a timestamp that is a date with no time yields a null clock time', () => {
    const [filing] = toFilings([row({ Timestamp: '2026-07-22' })]);
    expect(filing.at).toBeNull();
  });

  test('an unparseable id is dropped from the filings list', () => {
    expect(toFilings([row({ parade_response_id: 'not-an-id' })])).toEqual([]);
  });

  test('an id naming a company outside COMPANIES is dropped', () => {
    expect(toFilings([row({ parade_response_id: 'Phantom_2026-07-22_FPS' })])).toEqual([]);
  });

  test('an empty tab yields an empty list rather than throwing', () => {
    expect(toFilings([])).toEqual([]);
  });

  test('sorts by date then time', () => {
    const filings = toFilings([
      row({ Timestamp: '2026-07-22T09:00:00', parade_response_id: 'Archer_2026-07-22_FPS' }),
      row({ Timestamp: '2026-07-21T09:00:00', parade_response_id: 'Braves_2026-07-21_FPS' }),
      row({ Timestamp: '2026-07-22T07:00:00', parade_response_id: 'Cougar_2026-07-22_FPS' }),
    ]);
    expect(filings.map((filing) => filing.company)).toEqual(['Braves', 'Cougar', 'Archer']);
  });
});

describe('filingsOn', () => {
  test('a normal day lists every company that filed', () => {
    const filings = toFilings([
      row({ parade_response_id: 'Archer_2026-07-22_FPS' }),
      row({ parade_response_id: 'Braves_2026-07-22_FPS', Timestamp: '2026-07-22T07:05:00' }),
    ]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    const archer = result.find((entry) => entry.company === 'Archer');
    expect(archer).toEqual({ company: 'Archer', filed: true, at: { hour: 7, minute: 12, minutes: 432 } });
  });

  test('covers all six companies in COMPANIES order, missing ones marked filed:false', () => {
    const filings = toFilings([row({ parade_response_id: 'Archer_2026-07-22_FPS' })]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    expect(result.map((entry) => entry.company)).toEqual(COMPANIES);
    const braves = result.find((entry) => entry.company === 'Braves');
    expect(braves).toEqual({ company: 'Braves', filed: false, at: null });
  });

  test('a company filing twice in one day resolves to the later timestamp', () => {
    const filings = toFilings([
      row({ parade_response_id: 'Archer_2026-07-22_FPS', Timestamp: '2026-07-22T06:00:00' }),
      row({ parade_response_id: 'Archer_2026-07-22_FPS', Timestamp: '2026-07-22T08:30:00' }),
    ]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    const archer = result.find((entry) => entry.company === 'Archer');
    expect(archer.at).toEqual({ hour: 8, minute: 30, minutes: 510 });
  });

  test('defaults to the FPS session', () => {
    const filings = toFilings([row({ parade_response_id: 'Archer_2026-07-22_FPS' })]);
    const result = filingsOn(filings, '2026-07-22');
    expect(result.find((entry) => entry.company === 'Archer').filed).toBe(true);
  });

  test('an LPS filing does not appear in an FPS query for the same day', () => {
    const filings = toFilings([row({ parade_response_id: 'Archer_2026-07-22_LPS' })]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    expect(result.find((entry) => entry.company === 'Archer')).toEqual({
      company: 'Archer',
      filed: false,
      at: null,
    });
  });
});

describe('latestFilingPerCompany', () => {
  test('keeps only the later of two filings for the same company, date and session', () => {
    const filings = toFilings([
      row({ parade_response_id: 'Archer_2026-07-22_FPS', Timestamp: '2026-07-22T06:00:00' }),
      row({ parade_response_id: 'Archer_2026-07-22_FPS', Timestamp: '2026-07-22T08:30:00' }),
    ]);
    const latest = latestFilingPerCompany(filings, '2026-07-22', 'FPS');
    expect(latest.get('Archer').at.minutes).toBe(510);
  });
});
