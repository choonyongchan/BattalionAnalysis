/**
 * Tests for the report-sick Sankey.
 *
 * Parade state to FormSG is count-only: nothing is matched by name or 4D, so the cases
 * worth having there are the imbalances. From FormSG on, each submission is followed by its
 * own type, outcome and Status answers.
 */

import { describe, expect, test } from 'bun:test';
import type { PersonnelRow } from '../../shared/dashboard.ts';
import { personnelRows, submissionsOf } from './fixtures.ts';
import type { ReasonCategory } from '../../shared/domain.ts';
import { buildEpisodes, type Episode } from '../../frontend/src/model/episodes.ts';
import type { Submission } from '../../frontend/src/model/formsg.ts';
import { reportSickFlow } from '../../frontend/src/model/sankey.ts';

/** Episodes from terse personnel row specs. */
function episodesOf(specs: Partial<PersonnelRow>[]): Episode[] {
  return buildEpisodes(personnelRows(specs));
}

/** One soldier's row in a section, filed and starting on 20 Jul. */
function row(fourD: string, category: ReasonCategory, overrides: Partial<PersonnelRow> = {}): Partial<PersonnelRow> {
  return {
    date: '2026-07-20',
    company: 'Archer',
    fourD,
    name: 'SOLDIER ' + fourD,
    reasonCategory: category,
    startDate: '2026-07-20',
    ...overrides,
  };
}

/** One FormSG answer set: a type alone, or with an outcome and statuses. */
type Answer = string | { type: string; outcome?: string; statuses?: string[] };

/** Normalised FormSG submissions, one per answer set. */
function submissions(specs: Answer[]): Submission[] {
  return submissionsOf(
    specs.map((spec, index) => {
      const { type, outcome = '', statuses = [] } = typeof spec === 'string' ? { type: spec } : spec;
      return {
        timestamp: '2026-07-20T08:00:00',
        rank: 'REC',
        name: 'FORM ' + index,
        fourD: String(9000 + index),
        unitCoy: '40 SAR / Archer',
        company: 'Archer',
        reportSickType: type,
        outcome,
        statuses,
      };
    }),
  );
}

/** The value of the link between two nodes, 0 when there is none. */
function linkValue(flow: ReturnType<typeof reportSickFlow>, source: string, target: string): number {
  return flow.links.find((entry) => entry.source === source && entry.target === target)?.value ?? 0;
}

/** Runs the flow over an unbounded range. */
function flowOf(episodes: Episode[], subs: Submission[]) {
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
  test('each type code is its own node; a blank type is not recorded', () => {
    const flow = flowOf([], submissions(['RSO', 'RSI', 'FFI', 'MR', '']));
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
    expect(linkValue(flow, 'Type: RSI', 'Outcome: No MC or Status')).toBe(2);
    expect(linkValue(flow, 'Outcome: Status', 'Status: Excuse RMJ')).toBe(1);
    expect(linkValue(flow, 'Outcome: MC and Status', 'Status: Light Duty')).toBe(1);
    expect(flow.coverage).toMatchObject({ mc: 1, status: 1, both: 1, none: 2 });
  });

  test('parade-state MC and Status episodes do not feed the outcome stage', () => {
    const episodes = episodesOf([row('1101', 'Att C'), row('1102', 'Att C'), row('1103', 'Status', { reason: 'LD' })]);
    const flow = flowOf(episodes, submissions(['RSI']));
    expect(linkValue(flow, 'Type: RSI', 'Outcome: No MC or Status')).toBe(1);
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
      row('1102', 'Report Sick', { date: '2026-08-20', startDate: '2026-08-20' }),
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
    const stageOf = (name: string) => flow.nodes.find((node) => node.name === name)?.stage;
    expect(stageOf('Reporting sick')).toBe('reporting');
    expect(stageOf('Reported sick')).toBe('reported');
    expect(stageOf('Type: RSI')).toBe('type');
    expect(stageOf('Outcome: No MC or Status')).toBe('outcome');
  });
});
