/** Tests for the numbers the dashboard puts on screen. */

import { describe, expect, test } from 'bun:test';
import {
  absenceParts,
  battalionStrength,
  dutyCountsOn,
  episodeCounts,
  leaderboard,
  longMcRoster,
  longMcTrend,
  distinctDutyOn,
  otherDutiesOn,
  type DutyCounts,
} from '../../frontend/src/model/metrics.ts';
import type { PersonnelRow } from '../../shared/dashboard.ts';
import type { ReasonCategory } from '../../shared/domain.ts';
import { DUTY_CLASS, MC_MA } from '../../frontend/src/model/classify.ts';
import { UNASSIGNED } from '../../shared/domain.ts';
import { buildEpisodes } from '../../frontend/src/model/episodes.ts';
import { personnelRows, strengthRows } from './fixtures.ts';

describe('battalion strength', () => {
  test('platoon rows are excluded, so nothing is double-counted', () => {
    const rows = strengthRows([
      { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'Company', unitType: 'Company', totalStrength: 136, totalPresent: 120 },
      { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: '1', unitType: 'PLATOON', totalStrength: 55, totalPresent: 51 },
      { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'COMMANDERS', unitType: 'SUBUNIT', totalStrength: 25, totalPresent: 20 },
    ]);
    expect(battalionStrength(rows, '2026-06-22', 'FPS').accountable).toBe(136);
  });
});

describe('duty counts are of soldiers, not rows', () => {
  test('a soldier listed at both FPS and LPS counts once for the day', () => {
    const rows = personnelRows([
      { date: '2026-06-22', session: 'FPS', fourD: 'C1110', name: 'A', reasonCategory: 'Att C', reason: 'MC' },
      { date: '2026-06-22', session: 'LPS', fourD: 'C1110', name: 'A', reasonCategory: 'Att C', reason: 'MC' },
      { date: '2026-06-22', session: 'FPS', fourD: 'C1111', name: 'B', reasonCategory: 'Att C', reason: 'MC' },
    ]);
    expect(dutyCountsOn(rows, '2026-06-22').counts[DUTY_CLASS.ATT_C]).toBe(2);
  });

  test('rows naming no soldier are reported, not dropped', () => {
    const rows = personnelRows([{ date: '2026-06-22', session: 'FPS', reasonCategory: 'Att C', reason: 'MC' }]);
    const result = dutyCountsOn(rows, '2026-06-22');
    expect(result.unattributable).toBe(1);
    expect(result.counts[DUTY_CLASS.ATT_C]).toBe(0);
  });
});

describe('distinct MC / MA on a day', () => {
  const rows = () =>
    personnelRows([
        { date: '2026-06-22', session: 'FPS', fourD: 'C1110', name: 'A', reasonCategory: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'FPS', fourD: 'C1110', name: 'A', reasonCategory: 'MA', reason: 'MA' },
        { date: '2026-06-22', session: 'FPS', fourD: 'C1111', name: 'B', reasonCategory: 'MA', reason: 'MA' },
        { date: '2026-06-22', session: 'FPS', fourD: 'C1112', name: 'C', reasonCategory: 'Att C', reason: 'MC' },
        { date: '2026-06-21', session: 'FPS', fourD: 'C1113', name: 'D', reasonCategory: 'Att C', reason: 'MC' },
      ]);

  test('a soldier on both MC and MA counts once, and other days are excluded', () => {
    expect(distinctDutyOn(rows(), '2026-06-22', 'FPS', MC_MA)).toBe(3);
  });
});

describe('leaderboard', () => {
  /** Builds episodes for one soldier from start/end date pairs. */
  function episodesFor(id: string, spells: [string, string][], category: ReasonCategory = 'Att C') {
    const specs = spells.map(([start, end]): Partial<PersonnelRow> => ({
      date: start,
      session: 'FPS',
      company: 'Braves',
      platoon: '1',
      fourD: id,
      name: id,
      reasonCategory: category,
      startDate: start,
      endDate: end,
      reason: 'MC',
    }));
    return buildEpisodes(personnelRows(specs));
  }

  test('ranks by episode count first, then by days', () => {
    const episodes = [
      ...episodesFor('FREQ', [
        ['2026-06-01', '2026-06-01'],
        ['2026-06-08', '2026-06-08'],
        ['2026-06-15', '2026-06-15'],
      ]),
      ...episodesFor('LONG', [['2026-06-01', '2026-06-30']]),
    ];

    const ranked = leaderboard(episodes, DUTY_CLASS.ATT_C);
    expect(ranked[0]!.fourD).toBe('FREQ');
    expect(ranked[0]!.episodes).toBe(3);
    // The long single absence loses on episodes despite far more days lost, which is the
    // ordering a "most often" question asks for.
    expect(ranked[1]!.fourD).toBe('LONG');
    expect(ranked[1]!.daysLost).toBeGreaterThan(ranked[0]!.daysLost);
  });

  test('counts only the requested duty class', () => {
    const episodes = buildEpisodes(
      personnelRows([
          { date: '2026-06-01', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
          { date: '2026-06-02', fourD: 'A', name: 'A', reasonCategory: 'Status', startDate: '2026-06-02', endDate: '2026-06-02', reason: 'LD' },
        ])
    );
    expect(leaderboard(episodes, DUTY_CLASS.ATT_C)).toHaveLength(1);
    expect(leaderboard(episodes, DUTY_CLASS.ATT_C)[0]!.episodes).toBe(1);
    expect(leaderboard(episodes, DUTY_CLASS.STATUS)).toHaveLength(1);
  });

  test('carries the latest episode date so a stale entry is visible', () => {
    const ranked = leaderboard(
      episodesFor('A', [['2026-06-01', '2026-06-01'], ['2026-07-20', '2026-07-20']]),
      DUTY_CLASS.ATT_C
    );
    expect(ranked[0]!.lastStart).toBe('2026-07-20');
  });
});

describe('episode counts split volume from headcount', () => {
  /** Builds episodes from terse per-row specs. */
  function episodesOf(specs: Partial<PersonnelRow>[]) {
    return buildEpisodes(personnelRows(specs));
  }

  test('a soldier with two separate spells is two episodes but one soldier', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
        { date: '2026-06-15', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-15', endDate: '2026-06-15', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany).toEqual([{ key: 'Braves', episodes: 2, soldiers: 1 }]);
    expect(counts.total).toEqual({ episodes: 2, soldiers: 1, perSoldier: 2 });
  });

  test('MC and MA together count both, as the MC / MA page and the Overview tile do', () => {
    const episodes = episodesOf([
      { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
      { date: '2026-06-03', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'A', name: 'A', reasonCategory: 'MA', startDate: '2026-06-03', endDate: '2026-06-03', reason: 'Dental' },
      { date: '2026-06-04', session: 'FPS', company: 'Braves', platoon: '2', fourD: 'B', name: 'B', reasonCategory: 'MA', startDate: '2026-06-04', endDate: '2026-06-04', reason: 'Physio' },
    ]);
    expect(episodeCounts(episodes, DUTY_CLASS.ATT_C).total.episodes).toBe(1);
    expect(episodeCounts(episodes, MC_MA).total).toEqual({ episodes: 3, soldiers: 2, perSoldier: 1.5 });
  });

  test('two soldiers in one company are two episodes and two soldiers', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '2', fourD: 'B', name: 'B', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany.find((row) => row.key === 'Braves')).toEqual({
      key: 'Braves',
      episodes: 2,
      soldiers: 2,
    });
    expect(counts.total.perSoldier).toBe(1);
  });

  test('company groups lead with the most episodes; platoon groups follow the roll', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Archer', platoon: 'HQ', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '4', fourD: 'B', name: 'B', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '2', fourD: 'C', name: 'C', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany.map((row) => row.key)).toEqual(['Braves', 'Archer']);
  });

  test('the battalion soldier count is counted whole, not summed from the company groups', () => {
    // One soldier files once under each of two companies across the range.
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Archer', platoon: '1', fourD: 'MOVER', name: 'Mover', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
        { date: '2026-06-20', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'MOVER', name: 'Mover', reasonCategory: 'Att C', startDate: '2026-06-20', endDate: '2026-06-20', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany.reduce((sum, row) => sum + row.soldiers, 0)).toBe(2);
    expect(counts.total.soldiers).toBe(1);
    expect(counts.total.episodes).toBe(2);
  });


  test('only the requested duty class is counted', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'A', name: 'A', reasonCategory: 'Att C', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', fourD: 'B', name: 'B', reasonCategory: 'Status', startDate: '2026-06-01', endDate: '2026-06-01', reason: 'LD' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.total).toEqual({ episodes: 1, soldiers: 1, perSoldier: 1 });
  });
});


/** Builds episodes from terse Personnel Data row specs. */
function episodesFrom(specs: Partial<PersonnelRow>[]) {
  return buildEpisodes(personnelRows(specs));
}

/**
 * One row standing for a whole episode: the start date carries the grouping, so a single parade row with
 * stated start and end dates is one episode.
 */
function episodeRow(spec: Partial<PersonnelRow>): Partial<PersonnelRow> {
  return {
    date: spec.startDate ?? undefined,
    session: 'FPS',
    company: 'Cougar',
    platoon: '4',
    reasonCategory: 'Att C',
    reason: 'MC',
    ...spec,
  };
}

describe('longMcTrend', () => {
  test('counts each soldier on every day their long MC covers', () => {
    // Soldier A on Att C 1-14 Aug, Soldier B on Att C 5-30 Aug.
    const episodes = episodesFrom([
      episodeRow({ fourD: 'A1', name: 'ALPHA', startDate: '2026-08-01', endDate: '2026-08-14' }),
      episodeRow({ fourD: 'B2', name: 'BRAVO', startDate: '2026-08-05', endDate: '2026-08-30' }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-31', DUTY_CLASS.ATT_C);
    const on = (date: string) => trend.find((point) => point.date === date)!.count;
    expect(on('2026-08-02')).toBe(1); // only A
    expect(on('2026-08-06')).toBe(2); // A and B
    expect(on('2026-08-20')).toBe(1); // only B
    expect(on('2026-08-31')).toBe(0); // neither
    expect(trend).toHaveLength(31);
  });

  test('an MC of four days or fewer is never counted', () => {
    const episodes = episodesFrom([
      episodeRow({ fourD: 'S1', name: 'SHORT', startDate: '2026-08-01', endDate: '2026-08-04', numDays: 4 }),
      episodeRow({ fourD: 'L1', name: 'LONG', startDate: '2026-08-01', endDate: '2026-08-05', numDays: 5 }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-05', DUTY_CLASS.ATT_C);
    expect(trend.every((point) => point.count <= 1)).toBe(true);
    expect(trend.find((point) => point.date === '2026-08-03')!.count).toBe(1); // LONG only
  });

  test('with no stated day count the start-to-end span decides', () => {
    const episodes = episodesFrom([
      episodeRow({ fourD: 'X1', name: 'XRAY', startDate: '2026-08-01', endDate: '2026-08-10' }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-10', DUTY_CLASS.ATT_C);
    expect(trend.find((point) => point.date === '2026-08-07')!.count).toBe(1);
  });

  test('two overlapping long episodes for one soldier count once', () => {
    const episodes = episodesFrom([
      episodeRow({ fourD: 'D1', name: 'DELTA', startDate: '2026-08-01', endDate: '2026-08-10' }),
      episodeRow({ fourD: 'D1', name: 'DELTA', startDate: '2026-08-05', endDate: '2026-08-20' }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-20', DUTY_CLASS.ATT_C);
    expect(trend.find((point) => point.date === '2026-08-07')!.count).toBe(1);
  });

  test('a long episode of another duty class does not appear', () => {
    const episodes = episodesFrom([
      episodeRow({
        fourD: 'P1',
        name: 'PERM',
        reasonCategory: 'Status',
        reason: 'Status',
        startDate: '2026-08-01',
        endDate: '2026-08-30',
      }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-30', DUTY_CLASS.ATT_C);
    expect(trend.every((point) => point.count === 0)).toBe(true);
  });
});

describe('longMcRoster', () => {
  test('lists only the long episodes, longest first', () => {
    const episodes = episodesFrom([
      episodeRow({ fourD: 'S1', name: 'SHORT', startDate: '2026-08-01', endDate: '2026-08-04', numDays: 4 }),
      episodeRow({ fourD: 'M1', name: 'MID', startDate: '2026-08-01', endDate: '2026-08-07' }),
      episodeRow({ fourD: 'L1', name: 'LONG', startDate: '2026-08-01', endDate: '2026-08-20' }),
    ]);
    const roster = longMcRoster(episodes, DUTY_CLASS.ATT_C);
    expect(roster.map((row) => row.name)).toEqual(['LONG', 'MID']);
    expect(roster[0]!.days).toBe(20);
    expect(roster[0]!.startDate).toBe('2026-08-01');
    expect(roster[0]!.endDate).toBe('2026-08-20');
  });

  test('carries company and platoon, defaulting platoon to unassigned', () => {
    const episodes = episodesFrom([
      episodeRow({ fourD: 'N1', name: 'NOPLT', platoon: '', startDate: '2026-08-01', endDate: '2026-08-09' }),
    ]);
    const roster = longMcRoster(episodes, DUTY_CLASS.ATT_C);
    expect(roster[0]!.company).toBe('Cougar');
    expect(roster[0]!.platoon).toBe(UNASSIGNED);
  });

  test('a soldier with two long episodes gets a row each', () => {
    const episodes = episodesFrom([
      episodeRow({ fourD: 'T1', name: 'TWICE', startDate: '2026-08-01', endDate: '2026-08-10' }),
      episodeRow({ fourD: 'T1', name: 'TWICE', startDate: '2026-09-01', endDate: '2026-09-08' }),
    ]);
    const roster = longMcRoster(episodes, DUTY_CLASS.ATT_C);
    expect(roster).toHaveLength(2);
    expect(roster.map((row) => row.days)).toEqual([10, 8]);
  });
});

describe('absenceParts', () => {
  test('splits the absent classes only, in a fixed order', () => {
    const duty = { counts: { 'Att C': 3, MA: 1, 'Off/Leave': 4, Others: 0, Status: 9, 'Report Sick': 2, Unknown: 0 } } as DutyCounts;
    expect(absenceParts(duty)).toEqual([
      { name: 'MC', value: 3 },
      { name: 'MA', value: 1 },
      { name: 'Off / leave', value: 4 },
      { name: 'Other duties', value: 0 },
    ]);
  });
});

describe('otherDutiesOn', () => {
  test('groups other duties by the name before any bracket, counting soldiers once', () => {
    const rows = personnelRows([
      { date: '2026-06-22', session: 'FPS', company: 'Archer', fourD: '1', name: 'A', reasonCategory: 'Others', reason: 'Course (Safety)' },
      { date: '2026-06-22', session: 'LPS', company: 'Archer', fourD: '1', name: 'A', reasonCategory: 'Others', reason: 'COURSE' },
      { date: '2026-06-22', session: 'FPS', company: 'Archer', fourD: '2', name: 'B', reasonCategory: 'Others', reason: 'Course' },
      { date: '2026-06-22', session: 'FPS', company: 'Archer', fourD: '3', name: 'C', reasonCategory: 'Others', reason: 'Guard duty' },
      { date: '2026-06-22', session: 'FPS', company: 'Archer', fourD: '4', name: 'D', reasonCategory: 'Att C', reason: 'MC' },
    ]);
    expect(otherDutiesOn(rows, '2026-06-22', null)).toEqual([
      { name: 'COURSE', value: 2 },
      { name: 'GUARD DUTY', value: 1 },
    ]);
  });
});
