/**
 * Tests for the report-sick Sankey.
 *
 * The left side is an aggregate per-company join (`reconcileReportSick`), summed to
 * battalion totals: `Reporting sick`/`Unaccounted` into `Reported sick`/`No FormSG
 * submission` are counts of distinct soldiers, not events. The right side stays
 * event-level and hangs off the FormSG branch only — one flow per submission, through its
 * type to whatever MC or Status followed within two days.
 *
 * The cases worth having are the ones the diagram must not paper over: a soldier on the
 * parade state who never filed, a form with no parade-state line, one soldier filing
 * several forms, and an outcome deliberately too late to count.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../dashboard/src/data/records.js';
import { PERSONNEL_HEADERS } from '../../dashboard/src/data/tabs.js';
import { buildEpisodes } from '../../dashboard/src/model/episodes.js';
import { toSubmissions } from '../../dashboard/src/model/formsg.js';
import { reconcileReportSick } from '../../dashboard/src/model/reconcile.js';
import { reportSickFlow } from '../../dashboard/src/model/sankey.js';

/**
 * Builds Personnel Data records from column-keyed row specs.
 * @param {Array<!Object>} specs Partial records; unlisted headers read as ''.
 * @returns {Array<!Object>} Normalised records.
 */
function personnelRows(specs) {
  const values = [
    PERSONNEL_HEADERS.slice(),
    ...specs.map((spec) => PERSONNEL_HEADERS.map((header) => (header in spec ? spec[header] : ''))),
  ];
  return toRecords(values, PERSONNEL_HEADERS, 'Personnel Data');
}

/**
 * Builds a FormSG submission via the real normaliser, filling in defaults.
 * @param {!Object} overrides Fields to set on top of the defaults.
 * @returns {!Object} One normalised submission.
 */
function submission(overrides) {
  const row = {
    Timestamp: '2026-07-20T08:00:00',
    RANK: 'REC',
    '[Myinfo] Name': 'ZED',
    '4D Number (REC Only)': '1101',
    'Unit & Coy': '40 SAR / Archer',
    'Report Sick Type': 'Report Sick In-Camp (RSI)',
    ...overrides,
  };
  return toSubmissions([row])[0];
}

/**
 * A report-sick personnel row spec with the common fields pre-filled.
 * @param {!Object} overrides Fields to set on top of the defaults.
 * @returns {!Object} A row spec for `personnelRows`.
 */
function reportSick(overrides) {
  return {
    date: '2026-07-20',
    session: 'FPS',
    company: 'Archer',
    four_d: '1101',
    name: 'ZED',
    reason_category: 'Report Sick',
    start_date: '2026-07-20',
    ...overrides,
  };
}

/**
 * Sums link values between two node names, 0 when there is no such link.
 * @param {Array<{source: string, target: string, value: number}>} links The flow's links.
 * @param {string} source Source node name.
 * @param {string} target Target node name.
 * @returns {number} The link's value.
 */
function linkValue(links, source, target) {
  const link = links.find((entry) => entry.source === source && entry.target === target);
  return link ? link.value : 0;
}

/**
 * Sums every link leaving a node.
 * @param {Array<{source: string, value: number}>} links The flow's links.
 * @param {string} node The node name.
 * @returns {number} Total outflow.
 */
function outflow(links, node) {
  return links.filter((link) => link.source === node).reduce((sum, link) => sum + link.value, 0);
}

/**
 * Sums every link entering a node.
 * @param {Array<{target: string, value: number}>} links The flow's links.
 * @param {string} node The node name.
 * @returns {number} Total inflow.
 */
function inflow(links, node) {
  return links.filter((link) => link.target === node).reduce((sum, link) => sum + link.value, 0);
}

describe('reportSickFlow — left side (aggregate reconcile)', () => {
  test('a soldier reporting sick with no FormSG submission flows to No FormSG submission', () => {
    const personnel = personnelRows([reportSick({})]);
    const episodes = buildEpisodes(personnel);
    const flow = reportSickFlow({ personnel, episodes, submissions: [], from: null, to: null });

    expect(linkValue(flow.links, 'Reporting sick', 'No FormSG submission')).toBe(1);
    expect(flow.coverage.paradeOnly).toBe(1);
    expect(flow.coverage.matched).toBe(0);
  });

  test('a submission with no parade-state line flows Unaccounted -> Reported sick', () => {
    const flow = reportSickFlow({
      personnel: [],
      episodes: [],
      submissions: [submission({ '4D Number (REC Only)': '2201', '[Myinfo] Name': 'LIM' })],
      from: null,
      to: null,
    });

    expect(linkValue(flow.links, 'Unaccounted', 'Reported sick')).toBe(1);
    expect(flow.coverage.unaccounted).toBe(1);
    expect(linkValue(flow.links, 'Reported sick', 'Type: RSI')).toBe(1);
  });

  test('a soldier in both sources (same 4D, any in-range dates) flows Reporting sick -> Reported sick', () => {
    const personnel = personnelRows([reportSick({ start_date: '2026-07-18' })]);
    const episodes = buildEpisodes(personnel);
    const flow = reportSickFlow({
      personnel,
      episodes,
      submissions: [submission({ Timestamp: '2026-07-25T08:00:00' })],
      from: null,
      to: null,
    });

    expect(linkValue(flow.links, 'Reporting sick', 'Reported sick')).toBe(1);
    expect(flow.coverage.matched).toBe(1);
  });

  test('a fuzzy name match with no 4D on either side still counts as matched', () => {
    const personnel = personnelRows([
      reportSick({ four_d: '', name: 'TAN JUN HAO, DARREN', company: 'Braves' }),
    ]);
    const episodes = buildEpisodes(personnel);
    const flow = reportSickFlow({
      personnel,
      episodes,
      submissions: [
        submission({
          '4D Number (REC Only)': '',
          '[Myinfo] Name': 'TAN JUN HAO',
          'Unit & Coy': '40 SAR / Braves',
        }),
      ],
      from: null,
      to: null,
    });

    expect(linkValue(flow.links, 'Reporting sick', 'Reported sick')).toBe(1);
    expect(flow.coverage.matched).toBe(1);
  });

  test('the three left-side link values equal the reconcile sums for the same fixtures', () => {
    const personnel = personnelRows([
      reportSick({ four_d: '1101', name: 'ZED', company: 'Archer' }),
      reportSick({ four_d: '1102', name: 'ADA', company: 'Braves' }),
    ]);
    const episodes = buildEpisodes(personnel);
    const reportSickEpisodes = episodes.filter((episode) => episode.dutyClass === 'Report Sick');
    const submissions = [
      submission({ '4D Number (REC Only)': '1101' }),
      submission({
        '4D Number (REC Only)': '9999',
        '[Myinfo] Name': 'QUX',
        'Unit & Coy': '40 SAR / Cougar',
      }),
    ];

    const rows = reconcileReportSick(reportSickEpisodes, submissions);
    const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
    const expectedMatched = sum('matched');
    const expectedParadeOnly = sum('paradeCount') - expectedMatched;
    const expectedUnaccounted = sum('formsgCount') - expectedMatched;

    const flow = reportSickFlow({ personnel, episodes, submissions, from: null, to: null });

    expect(linkValue(flow.links, 'Reporting sick', 'Reported sick')).toBe(expectedMatched);
    expect(linkValue(flow.links, 'Reporting sick', 'No FormSG submission')).toBe(expectedParadeOnly);
    expect(linkValue(flow.links, 'Unaccounted', 'Reported sick')).toBe(expectedUnaccounted);
  });
});

describe('reportSickFlow — right side (per submission)', () => {
  test('a blank type answer routes to Type: Type not recorded', () => {
    const flow = reportSickFlow({
      personnel: [],
      episodes: [],
      submissions: [submission({ 'Report Sick Type': '' })],
      from: null,
      to: null,
    });
    expect(linkValue(flow.links, 'Reported sick', 'Type: Type not recorded')).toBe(1);
  });

  test('an MC starting the day after the submission is the outcome', () => {
    const personnel = personnelRows([
      { date: '2026-07-21', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Att C', start_date: '2026-07-21', end_date: '2026-07-23', num_days: 3 },
    ]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [submission({})],
      from: null,
      to: null,
    });
    expect(linkValue(flow.links, 'Type: RSI', 'Outcome: MC')).toBe(1);
  });

  test('MC beats Status when both fall in the window', () => {
    const personnel = personnelRows([
      { date: '2026-07-21', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Att C', start_date: '2026-07-21', end_date: '2026-07-22', num_days: 2 },
      { date: '2026-07-21', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Excuse RMJ', start_date: '2026-07-21' },
    ]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [submission({})],
      from: null,
      to: null,
    });
    expect(linkValue(flow.links, 'Type: RSI', 'Outcome: MC')).toBe(1);
    expect(linkValue(flow.links, 'Type: RSI', 'Outcome: Status')).toBe(0);
  });

  test('a Status starting four days after the submission is too late to count', () => {
    const personnel = personnelRows([
      { date: '2026-07-24', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Excuse RMJ', start_date: '2026-07-24' },
    ]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [submission({})],
      from: null,
      to: null,
    });
    expect(linkValue(flow.links, 'Type: RSI', 'Outcome: Status')).toBe(0);
    expect(linkValue(flow.links, 'Type: RSI', 'Outcome: None recorded')).toBe(1);
  });

  test('a multi-restriction Status outcome fans out to several buckets, flagged as such', () => {
    const personnel = personnelRows([
      { date: '2026-07-21', session: 'FPS', company: 'Archer', four_d: '1101', name: 'ZED', reason_category: 'Status', reason: 'Excuse RMJ, Heavy Load, Kneeling', start_date: '2026-07-21' },
    ]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [submission({})],
      from: null,
      to: null,
    });
    expect(linkValue(flow.links, 'Outcome: Status', 'Status: Excuse RMJ')).toBe(1);
    expect(linkValue(flow.links, 'Outcome: Status', 'Status: Excuse Heavy Load')).toBe(1);
    expect(linkValue(flow.links, 'Outcome: Status', 'Status: Excuse Kneeling/Squatting')).toBe(1);
    expect(flow.coverage.statusMultiLabelled).toBe(true);
  });
});

describe('reportSickFlow — coverage and conservation', () => {
  test('a company with no FormSG rows at all is named in coverage', () => {
    const personnel = personnelRows([reportSick({ company: 'Scorpion' })]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [],
      from: null,
      to: null,
    });
    expect(flow.coverage.companiesWithNoFormSg).toContain('Scorpion');
  });

  test('one soldier filing two submissions fans the FormSG branch out past the matched count', () => {
    const personnel = personnelRows([reportSick({})]);
    const episodes = buildEpisodes(personnel);
    const submissions = [submission({}), submission({ Timestamp: '2026-07-22T09:00:00' })];
    const flow = reportSickFlow({ personnel, episodes, submissions, from: null, to: null });

    expect(flow.coverage.matched).toBe(1);
    expect(flow.coverage.reportedSick).toBe(1);
    expect(flow.coverage.submissions).toBe(2);
    expect(flow.coverage.submissionFanout).toBe(true);
    expect(outflow(flow.links, 'Reported sick')).toBe(2);
  });

  test('events outside the date range are excluded', () => {
    const personnel = personnelRows([
      reportSick({ four_d: '1101', name: 'ZED', date: '2026-07-20', start_date: '2026-07-20' }),
      reportSick({ four_d: '1102', name: 'ADA', date: '2026-08-20', start_date: '2026-08-20' }),
    ]);
    const episodes = buildEpisodes(personnel);
    const flow = reportSickFlow({
      personnel,
      episodes,
      submissions: [],
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(flow.coverage.reportingSick).toBe(1);
  });

  test('empty inputs produce empty nodes and links rather than throwing', () => {
    const flow = reportSickFlow({ personnel: [], episodes: [], submissions: [], from: null, to: null });
    expect(flow.nodes).toEqual([]);
    expect(flow.links).toEqual([]);
    expect(flow.coverage.reportingSick).toBe(0);
  });

  test('Reporting sick outflow and Reported sick inflow reconcile with coverage', () => {
    const personnel = personnelRows([
      reportSick({ four_d: '1101', name: 'ZED', company: 'Archer' }),
      reportSick({ four_d: '1102', name: 'ADA', company: 'Archer' }),
    ]);
    const episodes = buildEpisodes(personnel);
    const submissions = [
      submission({ '4D Number (REC Only)': '1101' }),
      submission({ '4D Number (REC Only)': '3303', '[Myinfo] Name': 'BEE' }),
    ];
    const flow = reportSickFlow({ personnel, episodes, submissions, from: null, to: null });

    expect(outflow(flow.links, 'Reporting sick')).toBe(flow.coverage.reportingSick);
    expect(inflow(flow.links, 'Reported sick')).toBe(flow.coverage.reportedSick);
  });

  test('coverage carries exactly the fields the parent renders', () => {
    const personnel = personnelRows([reportSick({})]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [submission({})],
      from: null,
      to: null,
    });
    expect(Object.keys(flow.coverage).sort()).toEqual(
      [
        'byCompany',
        'companiesWithNoFormSg',
        'matchRule',
        'matched',
        'paradeOnly',
        'reportedSick',
        'reportingSick',
        'statusMultiLabelled',
        'submissionFanout',
        'submissions',
        'unaccounted',
      ].sort()
    );
  });

  test('nodes carry their stage', () => {
    const personnel = personnelRows([reportSick({})]);
    const flow = reportSickFlow({
      personnel,
      episodes: buildEpisodes(personnel),
      submissions: [submission({})],
      from: null,
      to: null,
    });
    const stageOf = (name) => (flow.nodes.find((node) => node.name === name) || {}).stage;
    expect(stageOf('Reporting sick')).toBe('reporting');
    expect(stageOf('Reported sick')).toBe('reported');
    expect(stageOf('Type: RSI')).toBe('type');
    expect(stageOf('Outcome: None recorded')).toBe('outcome');
  });
});
