/**
 * Tests for the report-sick Sankey.
 *
 * Parade state to FormSG is count-only: nothing is matched by name or 4D, so the cases
 * worth having there are the imbalances. From FormSG on, each submission is followed by its
 * own type, outcome and Status answers.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS } from '../../src/data/tabs.js';
import { buildEpisodes } from '../../src/model/episodes.js';
import { toSubmissions } from '../../src/model/formsg.js';
import { reportSickFlow } from '../../src/model/sankey.js';

/**
 * Builds episodes from column-keyed Personnel Data row specs.
 * @param {Array<!Object>} specs Partial records; unlisted headers read as ''.
 * @returns {Array<!Object>} Episodes from `buildEpisodes`.
 */
function episodesOf(specs) {
  const values = [
    PERSONNEL_HEADERS.slice(),
    ...specs.map((spec) => PERSONNEL_HEADERS.map((header) => (header in spec ? spec[header] : ''))),
  ];
  return buildEpisodes(toRecords(values, PERSONNEL_HEADERS, 'Personnel Data'));
}

/**
 * A personnel row spec for one soldier, with the common fields pre-filled.
 * @param {string} fourD The soldier's 4D, which keeps soldiers distinct.
 * @param {string} category The row's reason category.
 * @param {!Object=} overrides Fields to set on top of the defaults.
 * @returns {!Object} A row spec for `episodesOf`.
 */
function row(fourD, category, overrides) {
  return {
    date: '2026-07-20',
    session: 'FPS',
    company: 'Archer',
    four_d: fourD,
    name: 'SOLDIER ' + fourD,
    reason_category: category,
    start_date: '2026-07-20',
    ...overrides,
  };
}

/**
 * Builds normalised FormSG submissions, one per spec.
 * @param {Array<string|{type: string, outcome?: string, statuses?: Array<string>}>} specs
 *     Each submission's 'Report Sick Type' answer, or that plus its outcome and Statuses.
 * @returns {Array<!Object>} Normalised submissions.
 */
function submissions(specs) {
  return toSubmissions(
    specs.map((spec, index) => {
      const { type, outcome = '', statuses = [] } = typeof spec === 'string' ? { type: spec } : spec;
      return {
        Timestamp: '2026-07-20T08:00:00',
        RANK: 'REC',
        '[Myinfo] Name': 'FORM ' + index,
        '4D Number (REC Only)': String(9000 + index),
        'Unit & Coy': '40 SAR / Archer',
        'Report Sick Type': type,
        'Outcome given by the doctor/MO': outcome,
        ...Object.fromEntries(statuses.map((status, i) => ['Status Given #' + (i + 1), status])),
      };
    })
  );
}

/**
 * The value of the link between two nodes, 0 when there is none.
 * @param {!Object} flow A `reportSickFlow` result.
 * @param {string} source Source node name.
 * @param {string} target Target node name.
 * @returns {number} The link's value.
 */
function linkValue(flow, source, target) {
  const link = flow.links.find((entry) => entry.source === source && entry.target === target);
  return link ? link.value : 0;
}

/**
 * Runs the flow over an unbounded range.
 * @param {Array<!Object>} episodes Episodes.
 * @param {Array<!Object>} subs Submissions.
 * @returns {!Object} The flow.
 */
function flowOf(episodes, subs) {
  return reportSickFlow({ episodes, submissions: subs, from: null, to: null });
}

describe('reportSickFlow — reporting to reported', () => {
  test('fewer parade-state reports than forms: all flow on, the surplus is Unaccounted', () => {
    const flow = flowOf(episodesOf([row('1101', 'Report Sick')]), submissions(['RSI', 'RSO', 'RSI']));
    expect(linkValue(flow, 'Reporting sick', 'Reported sick')).toBe(1);
    expect(linkValue(flow, 'Unaccounted', 'Reported sick')).toBe(2);
    expect(linkValue(flow, 'Reporting sick', 'No FormSG submission')).toBe(0);
  });

  test('more parade-state reports than forms: the surplus ends at No FormSG submission', () => {
    const episodes = episodesOf([row('1101', 'Report Sick'), row('1102', 'Report Sick'), row('1103', 'Report Sick')]);
    const flow = flowOf(episodes, submissions(['RSI']));
    expect(linkValue(flow, 'Reporting sick', 'Reported sick')).toBe(1);
    expect(linkValue(flow, 'Reporting sick', 'No FormSG submission')).toBe(2);
    expect(linkValue(flow, 'Unaccounted', 'Reported sick')).toBe(0);
  });

  test('different names on each side still flow through, since nothing is matched', () => {
    const flow = flowOf(episodesOf([row('1101', 'Report Sick')]), submissions(['RSI']));
    expect(linkValue(flow, 'Reporting sick', 'Reported sick')).toBe(1);
  });
});

describe('reportSickFlow — type, outcome, status', () => {
  test('types take both the short code and the verbatim answer; blank is not recorded', () => {
    const flow = flowOf([], submissions(['RSO', 'Report Sick In-Camp (RSI)', 'FFI', 'MR', '']));
    ['RSO', 'RSI', 'FFI', 'Medical Review', 'Type not recorded'].forEach((label) => {
      expect(linkValue(flow, 'Reported sick', 'Type: ' + label)).toBe(1);
    });
  });

  test('each submission flows from its own type to its own FormSG outcome', () => {
    const flow = flowOf(
      [],
      submissions([
        { type: 'RSO', outcome: 'MC' },
        { type: 'RSI', outcome: 'Status', statuses: ['Excuse RMJ'] },
        { type: 'RSI', outcome: 'Both', statuses: ['Light Duty'] },
        { type: 'RSI', outcome: 'None' },
        { type: 'RSI' },
      ])
    );
    expect(linkValue(flow, 'Type: RSO', 'Outcome: MC')).toBe(1);
    expect(linkValue(flow, 'Type: RSI', 'Outcome: Status')).toBe(1);
    expect(linkValue(flow, 'Type: RSI', 'Outcome: MC and Status')).toBe(1);
    expect(linkValue(flow, 'Type: RSI', 'Outcome: No MC or Status')).toBe(1);
    expect(linkValue(flow, 'Type: RSI', 'Outcome: Not recorded')).toBe(1);
    expect(linkValue(flow, 'Outcome: Status', 'Status: Excuse RMJ')).toBe(1);
    expect(linkValue(flow, 'Outcome: MC and Status', 'Status: Light Duty')).toBe(1);
    expect(flow.coverage).toMatchObject({ mc: 1, status: 1, both: 1, none: 1, notRecorded: 1 });
  });

  test('parade-state MC and Status episodes do not feed the outcome stage', () => {
    const episodes = episodesOf([row('1101', 'Att C'), row('1102', 'Att C'), row('1103', 'Status', { reason: 'LD' })]);
    const flow = flowOf(episodes, submissions(['RSI']));
    expect(linkValue(flow, 'Type: RSI', 'Outcome: Not recorded')).toBe(1);
    expect(linkValue(flow, 'Type: RSI', 'Outcome: MC')).toBe(0);
    expect(flow.coverage.mc).toBe(0);
  });

  test('a submission with several Statuses is carried to one bucket only', () => {
    const flow = flowOf([], submissions([{ type: 'RSI', outcome: 'Status', statuses: ['Excuse RMJ, Heavy Load', 'LD'] }]));
    const bucketLinks = flow.links.filter((link) => link.source === 'Outcome: Status');
    expect(bucketLinks).toEqual([{ source: 'Outcome: Status', target: 'Status: Excuse RMJ', value: 1 }]);
  });
});

describe('reportSickFlow — range and empty inputs', () => {
  test('events outside the date range are excluded', () => {
    const episodes = episodesOf([
      row('1101', 'Report Sick'),
      row('1102', 'Report Sick', { date: '2026-08-20', start_date: '2026-08-20' }),
    ]);
    const flow = reportSickFlow({ episodes, submissions: [], from: '2026-08-01', to: '2026-08-31' });
    expect(flow.coverage.reportingSick).toBe(1);
  });

  test('empty inputs produce empty nodes and links', () => {
    const flow = flowOf([], []);
    expect(flow.nodes).toEqual([]);
    expect(flow.links).toEqual([]);
  });

  test('nodes carry their stage', () => {
    const flow = flowOf(episodesOf([row('1101', 'Report Sick')]), submissions(['RSI']));
    const stageOf = (name) => (flow.nodes.find((node) => node.name === name) || {}).stage;
    expect(stageOf('Reporting sick')).toBe('reporting');
    expect(stageOf('Reported sick')).toBe('reported');
    expect(stageOf('Type: RSI')).toBe('type');
    expect(stageOf('Outcome: Not recorded')).toBe('outcome');
  });
});
