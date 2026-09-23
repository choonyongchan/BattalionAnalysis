/**
 * Tests for normalising FormSG report-sick submissions.
 *
 * The cases worth having are the ones that would fail silently: the "Report Sick Type"
 * answer dropped on the floor, and a type breakdown whose slices do not add up to the
 * submissions they came from.
 */

import { describe, expect, test } from 'bun:test';
import {
  submissionCounts,
  submissionHeatmapCells,
  submissionPlatoonOf,
  submissionRateByPlatoon,
  submissionTrend,
  toSubmissions,
} from '../../src/model/formsg.js';
import { toRecords } from '../../src/data/records.js';
import { STRENGTH_HEADERS } from '../../src/data/tabs.js';

/**
 * A FormSG response row, as `toSubmissions` reads it: an object keyed by header.
 * @param {!Object} overrides Fields to set or replace.
 * @returns {!Object} A row with sane defaults.
 */
function row(overrides) {
  return {
    Timestamp: '2026-06-22 08:30:00',
    RANK: 'REC',
    '[Myinfo] Name': 'TAN JUN HAO',
    '4D Number (REC Only)': '3203',
    'Unit & Coy': 'Cougar Coy',
    'Report Sick Type': 'Report Sick In-Camp (RSI)',
    'Reason for Reporting Sick (Keep Brief)': 'fever',
    'I am experiencing _____________________ symptoms.': 'fever, cough',
    ...overrides,
  };
}

describe('toSubmissions', () => {
  test('surfaces the report sick type verbatim', () => {
    const [submission] = toSubmissions([row({ 'Report Sick Type': '  FFI  ' })]);
    expect(submission.reportSickType).toBe('FFI');
  });

  test('a placeholder 4D is no identity: people who typed NIL, Nil or Rec stay apart', () => {
    const submissions = toSubmissions([
      row({ '[Myinfo] Name': 'ALPHA ONE', '4D Number (REC Only)': 'NIL' }),
      row({ '[Myinfo] Name': 'BRAVO TWO', '4D Number (REC Only)': 'Nil' }),
      row({ '[Myinfo] Name': 'CHARLIE THREE', '4D Number (REC Only)': 'Rec' }),
      row({ '[Myinfo] Name': 'DELTA FOUR', '4D Number (REC Only)': ' n/a ' }),
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
    const [submission] = toSubmissions([row({ '4D Number (REC Only)': ' 3203 ' })]);
    expect(submission.key).toBe('4D:3203');
  });

  test('a row with no type column reads as blank, not undefined', () => {
    const bare = row({});
    delete bare['Report Sick Type'];
    expect(toSubmissions([bare])[0].reportSickType).toBe('');
  });
});

/**
 * Builds Strength Data records from column-keyed row specs.
 * @param {Array<!Object>} specs Partial records; unlisted headers read as ''.
 * @returns {Array<!Object>} Normalised records.
 */
function strengthRows(specs) {
  const values = [
    STRENGTH_HEADERS.slice(),
    ...specs.map((spec) => STRENGTH_HEADERS.map((header) => (header in spec ? spec[header] : ''))),
  ];
  return toRecords(values, STRENGTH_HEADERS, 'Strength Data');
}

describe('submissionTrend', () => {
  test('companies scope counts submissions per company, zero for a company with none', () => {
    const submissions = toSubmissions([
      row({ 'Unit & Coy': '40 SAR / Archer', Timestamp: '2026-07-20 08:00:00' }),
      row({ 'Unit & Coy': '40 SAR / Archer', Timestamp: '2026-07-20 09:00:00' }),
    ]);
    const trend = submissionTrend(submissions, [], ['2026-07-20'], { scope: 'companies' });
    const archer = trend.series.find((s) => s.name === 'Archer');
    const hercules = trend.series.find((s) => s.name === 'Hercules');
    expect(archer.values[0]).toBe(2);
    expect(hercules.values[0]).toBe(0);
  });

  test('battalion scope returns a rate per 100 accountable', () => {
    const submissions = toSubmissions([row({ Timestamp: '2026-07-20 08:00:00' })]);
    const strength = strengthRows([
      { date: '2026-07-20', session: 'FPS', company: 'Cougar', unit_type: 'Company', total_strength: 100, total_present: 90 },
    ]);
    const trend = submissionTrend(submissions, strength, ['2026-07-20'], { scope: 'battalion' });
    expect(trend.series[0].values[0]).toBeCloseTo(1);
  });

  test('a day with no strength on record reads as zero, not a division error', () => {
    const submissions = toSubmissions([row({ Timestamp: '2026-07-20 08:00:00' })]);
    const trend = submissionTrend(submissions, [], ['2026-07-20'], { scope: 'battalion' });
    expect(trend.series[0].values[0]).toBe(0);
  });
});

describe('submissionPlatoonOf', () => {
  test('reads the platoon digit that leads the 4D', () => {
    expect(submissionPlatoonOf({ fourD: '3203' })).toBe('3');
  });

  test('skips a single company-letter prefix on the 4D', () => {
    expect(submissionPlatoonOf({ fourD: 'C1204' })).toBe('1');
  });

  test('a blank 4D lands under HQ, not a separate unassigned bucket', () => {
    expect(submissionPlatoonOf({ fourD: '' })).toBe('HQ');
  });

  test('a 4D whose leading digit is not a platoon lands under HQ', () => {
    expect(submissionPlatoonOf({ fourD: '9203' })).toBe('HQ');
    expect(submissionPlatoonOf({ fourD: 'ABCD' })).toBe('HQ');
  });
});

describe('submissionCounts', () => {
  test('counts submissions, distinct submitters, and their ratio', () => {
    const counts = submissionCounts([
      { key: '4D:3203' },
      { key: '4D:3203' },
      { key: '4D:1111' },
    ]);
    expect(counts.total).toEqual({ submissions: 3, soldiers: 2, perSoldier: 1.5 });
  });

  test('a submission with no identity still counts as a submission, not a soldier', () => {
    const counts = submissionCounts([{ key: '4D:3203' }, { key: '' }]);
    expect(counts.total.submissions).toBe(2);
    expect(counts.total.soldiers).toBe(1);
  });

  test('no submissions reads as a null mean, not a division error', () => {
    expect(submissionCounts([]).total).toEqual({ submissions: 0, soldiers: 0, perSoldier: null });
  });
});

describe('submissionHeatmapCells', () => {
  test('counts submissions per company x inferred platoon, dropping unknown companies', () => {
    const cells = submissionHeatmapCells([
      { company: 'Cougar', fourD: '3203' },
      { company: 'Cougar', fourD: '3299' },
      { company: 'Archer', fourD: '' },
      { company: '', fourD: '1234' },
    ]);
    expect(cells).toContainEqual({ row: 'Cougar', column: '3', value: 2 });
    expect(cells).toContainEqual({ row: 'Archer', column: 'HQ', value: 1 });
    expect(cells.length).toBe(2);
  });
});

describe('submissionRateByPlatoon', () => {
  test('rate divides submissions by the platoon-row strength, ignoring the company total', () => {
    const submissions = [
      { company: 'Cougar', fourD: '3203' },
      { company: 'Cougar', fourD: '3299' },
    ];
    const strength = strengthRows([
      { company: 'Cougar', platoon: '3', unit_type: 'Platoon', total_strength: 100 },
      { company: 'Cougar', platoon: '3', unit_type: 'Company', total_strength: 999 },
    ]);
    const rows = submissionRateByPlatoon(submissions, strength);
    expect(rows).toContainEqual({ company: 'Cougar', platoon: '3', count: 2, per100: 2 });
  });

  test('a platoon with submissions but no strength on record reads per100 null', () => {
    const rows = submissionRateByPlatoon([{ company: 'Archer', fourD: '' }], []);
    expect(rows).toContainEqual({ company: 'Archer', platoon: 'HQ', count: 1, per100: null });
  });

  test('ranks by rate, highest first', () => {
    const submissions = [
      { company: 'Cougar', fourD: '1203' },
      { company: 'Archer', fourD: '2203' },
      { company: 'Archer', fourD: '2299' },
    ];
    const strength = strengthRows([
      { company: 'Cougar', platoon: '1', unit_type: 'Platoon', total_strength: 100 },
      { company: 'Archer', platoon: '2', unit_type: 'Platoon', total_strength: 100 },
    ]);
    const rows = submissionRateByPlatoon(submissions, strength);
    expect(rows.map((r) => r.company + r.platoon)).toEqual(['Archer2', 'Cougar1']);
  });
});
