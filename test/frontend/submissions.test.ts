/**
 * Tests for when each company filed. The chart shows who is missing, so a company that never filed
 * must still appear, and a double filing must resolve to the later timestamp.
 */

import { describe, expect, test } from 'bun:test';
import { filingTimes, filingsOn, latestFilingPerCompany, toFilings } from '../../frontend/src/model/submissions.ts';
import { COMPANIES } from '../../shared/domain.ts';
import type { FilingRow } from '../../shared/dashboard.ts';
import { filingRow } from './fixtures.ts';

/** A filing row with sane defaults. */
function row(overrides: Partial<FilingRow>): FilingRow {
  return filingRow({
    timestamp: '2026-07-22T07:12:00',
    paradeResponseId: 'Archer_2026-07-22_FPS',
    ...overrides,
  });
}

describe('toFilings', () => {
  test('parses company, date and session from the id, and clock time from the timestamp', () => {
    const [filing] = toFilings([row({})]);
    expect(filing).toEqual({
      company: 'Archer',
      date: '2026-07-22',
      session: 'FPS',
      at: { hour: 7, minute: 12, minutes: 432 },
      filedOn: '2026-07-22',
      id: 'Archer_2026-07-22_FPS',
    });
  });

  test('a timestamp that is a date with no time yields a null clock time', () => {
    const [filing] = toFilings([row({ timestamp: '2026-07-22' })]);
    expect(filing?.at).toBeNull();
  });

  test('an unparseable id is dropped from the filings list', () => {
    expect(toFilings([row({ paradeResponseId: 'not-an-id' })])).toEqual([]);
  });

  test('an id naming a company outside COMPANIES is dropped', () => {
    expect(toFilings([row({ paradeResponseId: 'Phantom_2026-07-22_FPS' })])).toEqual([]);
  });

  test('an empty tab yields an empty list rather than throwing', () => {
    expect(toFilings([])).toEqual([]);
  });

  test('sorts by date then time', () => {
    const filings = toFilings([
      row({ timestamp: '2026-07-22T09:00:00', paradeResponseId: 'Archer_2026-07-22_FPS' }),
      row({ timestamp: '2026-07-21T09:00:00', paradeResponseId: 'Braves_2026-07-21_FPS' }),
      row({ timestamp: '2026-07-22T07:00:00', paradeResponseId: 'Cougar_2026-07-22_FPS' }),
    ]);
    expect(filings.map((filing) => filing.company)).toEqual(['Braves', 'Cougar', 'Archer']);
  });
});

describe('filingsOn', () => {
  test('a normal day lists every company that filed', () => {
    const filings = toFilings([
      row({ paradeResponseId: 'Archer_2026-07-22_FPS' }),
      row({ paradeResponseId: 'Braves_2026-07-22_FPS', timestamp: '2026-07-22T07:05:00' }),
    ]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    const archer = result.find((entry) => entry.company === 'Archer')!;
    expect(archer).toEqual({ company: 'Archer', filed: true, at: { hour: 7, minute: 12, minutes: 432 } });
  });

  test('covers all six companies in COMPANIES order, missing ones marked filed:false', () => {
    const filings = toFilings([row({ paradeResponseId: 'Archer_2026-07-22_FPS' })]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    expect(result.map((entry) => entry.company)).toEqual([...COMPANIES]);
    const braves = result.find((entry) => entry.company === 'Braves')!;
    expect(braves).toEqual({ company: 'Braves', filed: false, at: null });
  });

  test('a company filing twice in one day resolves to the later timestamp', () => {
    const filings = toFilings([
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T06:00:00' }),
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T08:30:00' }),
    ]);
    const result = filingsOn(filings, '2026-07-22', 'FPS');
    const archer = result.find((entry) => entry.company === 'Archer')!;
    expect(archer.at).toEqual({ hour: 8, minute: 30, minutes: 510 });
  });

  test('defaults to the FPS session', () => {
    const filings = toFilings([row({ paradeResponseId: 'Archer_2026-07-22_FPS' })]);
    const result = filingsOn(filings, '2026-07-22');
    expect(result.find((entry) => entry.company === 'Archer')!.filed).toBe(true);
  });

  test('an LPS filing does not appear in an FPS query for the same day', () => {
    const filings = toFilings([row({ paradeResponseId: 'Archer_2026-07-22_LPS' })]);
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
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T06:00:00' }),
      row({ paradeResponseId: 'Archer_2026-07-22_FPS', timestamp: '2026-07-22T08:30:00' }),
    ]);
    const latest = latestFilingPerCompany(filings, '2026-07-22', 'FPS');
    expect(latest.get('Archer')?.at?.minutes).toBe(510);
  });
});

describe('filingTimes', () => {
  test('values the first filing of each company-day in minutes past 08:00, counting next-day filings apart', () => {
    const filings = toFilings([
      { timestamp: '2026-10-08T07:17:00', paradeResponseId: 'Archer_2026-10-08_FPS' },
      { timestamp: '2026-10-08T09:30:00', paradeResponseId: 'Archer_2026-10-08_FPS' },
      { timestamp: '2026-10-08T11:11:00', paradeResponseId: 'Stallion_2026-10-08_FPS' },
      { timestamp: '2026-10-08T08:05:00', paradeResponseId: 'Braves_2026-10-07_FPS' },
    ]);
    const { cells, onTime, filed, nextDay } = filingTimes(filings, ['2026-10-07', '2026-10-08']);
    expect(cells.map((c) => [c.row, c.column, c.value])).toEqual([
      ['Archer', '2026-10-08', 0],
      ['Stallion', '2026-10-08', 191],
    ]);
    expect([onTime.Archer, onTime.Stallion, filed.Braves, nextDay]).toEqual([1, 0, 1, 1]);
  });
});
