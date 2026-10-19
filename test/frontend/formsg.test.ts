/** Tests for FormSG report-sick submissions: the type answer kept, and breakdowns that add up. */

import { describe, expect, test } from 'bun:test';
import type { ReportSickRow } from '../../shared/dashboard.ts';
import { strengthRows, submission, submissionsOf } from './fixtures.ts';
import {
  hourByWeekday,
  reportSickTypeOf,
  typeShares,
  submissionCounts,
  submissionTrend,
} from '../../frontend/src/model/formsg.ts';

/** A FormSG row spec with sane defaults. */
function row(overrides: Partial<ReportSickRow>): Partial<ReportSickRow> {
  return {
    timestamp: '2026-06-22 08:30:00',
    rank: 'REC',
    name: 'TAN JUN HAO',
    fourD: '3203',
    unitCoy: 'Cougar Coy',
    company: 'Cougar',
    reportSickType: 'RSI',
    reason: 'fever',
    symptoms: 'fever, cough',
    ...overrides,
  };
}

describe('toSubmissions', () => {
  test('surfaces the report sick type verbatim', () => {
    const [submission] = submissionsOf([row({ reportSickType: '  FFI  ' })]);
    expect(submission?.reportSickType).toBe('FFI');
  });

  test('a placeholder 4D is no identity: people who typed NIL, Nil or Rec stay apart', () => {
    const submissions = submissionsOf([
      row({ name: 'ALPHA ONE', fourD: 'NIL' }),
      row({ name: 'BRAVO TWO', fourD: 'Nil' }),
      row({ name: 'CHARLIE THREE', fourD: 'Rec' }),
      row({ name: 'DELTA FOUR', fourD: ' n/a ' }),
    ]);
    expect(submissions.map((s) => s.key)).toEqual([
      'NAME:ALPHA ONE',
      'NAME:BRAVO TWO',
      'NAME:CHARLIE THREE',
      'NAME:DELTA FOUR',
    ]);
    expect(submissionCounts(submissions).total.soldiers).toBe(4);
  });

  test('a real 4D keys the soldier, so the Sankey can join it to the parade state', () => {
    const [submission] = submissionsOf([row({ fourD: ' 3203 ' })]);
    expect(submission?.key).toBe('4D:3203');
  });

  test('a row with no type reads as blank, not undefined', () => {
    expect(submissionsOf([row({ reportSickType: null })])[0]!.reportSickType).toBe('');
  });
});

describe('submissionTrend', () => {
  test('companies scope counts submissions per company, zero for a company with none', () => {
    const submissions = submissionsOf([
      row({ unitCoy: '40 SAR / Archer', company: 'Archer', timestamp: '2026-07-20 08:00:00' }),
      row({ unitCoy: '40 SAR / Archer', company: 'Archer', timestamp: '2026-07-20 09:00:00' }),
    ]);
    const trend = submissionTrend(submissions, [], ['2026-07-20'], { scope: 'companies' });
    const archer = trend.series.find((s) => s.name === 'Archer')!;
    const hercules = trend.series.find((s) => s.name === 'Hercules')!;
    expect(archer.values[0]).toBe(2);
    expect(hercules.values[0]).toBe(0);
  });

  test('battalion scope returns a rate per 100 accountable', () => {
    const submissions = submissionsOf([row({ timestamp: '2026-07-20 08:00:00' })]);
    const strength = strengthRows([
      { date: '2026-07-20', session: 'FPS', company: 'Cougar', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
    ]);
    const trend = submissionTrend(submissions, strength, ['2026-07-20'], { scope: 'battalion' });
    expect(trend.series[0]!.values[0]).toBeCloseTo(1);
  });

  test('a day with no strength on record reads as zero, not a division error', () => {
    const submissions = submissionsOf([row({ timestamp: '2026-07-20 08:00:00' })]);
    const trend = submissionTrend(submissions, [], ['2026-07-20'], { scope: 'battalion' });
    expect(trend.series[0]!.values[0]).toBe(0);
  });

  test('asRate:false returns the raw submission count and ignores strength', () => {
    const submissions = submissionsOf([
      row({ timestamp: '2026-07-20 08:00:00' }),
      row({ timestamp: '2026-07-20 09:00:00' }),
    ]);
    const strength = strengthRows([
      { date: '2026-07-20', session: 'FPS', company: 'Cougar', unitType: 'Company', totalStrength: 100, totalPresent: 90 },
    ]);
    const trend = submissionTrend(submissions, strength, ['2026-07-20'], {
      scope: 'battalion',
      asRate: false,
    });
    expect(trend.series[0]!.values[0]).toBe(2);
  });
});

describe('submissionCounts', () => {
  test('counts submissions, distinct submitters, and their ratio', () => {
    const counts = submissionCounts([
      submission({ key: '4D:3203' }),
      submission({ key: '4D:3203' }),
      submission({ key: '4D:1111' }),
    ]);
    expect(counts.total).toEqual({ submissions: 3, soldiers: 2, perSoldier: 1.5 });
  });

  test('a submission with no identity still counts as a submission, not a soldier', () => {
    const counts = submissionCounts([submission({ key: '4D:3203' }), submission({ key: '' })]);
    expect(counts.total.submissions).toBe(2);
    expect(counts.total.soldiers).toBe(1);
  });

  test('no submissions reads as a null mean, not a division error', () => {
    expect(submissionCounts([]).total).toEqual({ submissions: 0, soldiers: 0, perSoldier: null });
  });
});

describe('reportSickTypeOf', () => {
  test('reads the stored short code', () => {
    expect(reportSickTypeOf(submission({ reportSickType: 'RSO' }))).toBe('RSO');
    expect(reportSickTypeOf(submission({ reportSickType: 'RSI' }))).toBe('RSI');
    expect(reportSickTypeOf(submission({ reportSickType: 'MR' }))).toBe('MR');
    expect(reportSickTypeOf(submission({ reportSickType: 'FFI' }))).toBe('FFI');
  });

  test('an unrecorded or pending type matches no filter option', () => {
    expect(reportSickTypeOf(submission({ reportSickType: '' }))).toBe('');
    expect(reportSickTypeOf(submission({ reportSickType: 'PENDING' }))).toBe('');
  });
});

describe('typeShares', () => {
  test('counts each type in the form order, with unknown answers as Not stated', () => {
    const shares = typeShares([submission({ reportSickType: 'RSO' }), submission({ reportSickType: 'RSO' }), submission({ reportSickType: 'MR' }), submission({ reportSickType: 'odd' })]);
    expect(shares).toEqual([
      { name: 'RSO', value: 2 },
      { name: 'RSI', value: 0 },
      { name: 'FFI', value: 0 },
      { name: 'Medical Review', value: 1 },
      { name: 'Not stated', value: 1 },
    ]);
  });
});

describe('hourByWeekday', () => {
  test('places each submission on its weekday and hour, skipping untimed ones', () => {
    const cells = hourByWeekday([
      submission({ date: '2026-09-21', timestamp: '2026-09-21 08:15:00' }),
      submission({ date: '2026-09-21', timestamp: '2026-09-21 08:40:00' }),
      submission({ date: '2026-09-26', timestamp: '2026-09-26 22:05:00' }),
      submission({ date: '2026-09-26', timestamp: '' }),
    ]);
    expect(cells).toEqual([
      { row: 'Mon', column: '08', value: 2 },
      { row: 'Sat', column: '22', value: 1 },
    ]);
  });
});
