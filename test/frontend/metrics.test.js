/**
 * Tests for the numbers the dashboard puts on screen.
 *
 * The two that matter most are structural rather than arithmetic: a battalion total says
 * how many companies it covers, and a soldier listed at both FPS and LPS is one soldier.
 * Every case here builds its own rows, so the figures asserted are the figures those
 * rows imply.
 */

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
} from '../../frontend/src/model/metrics.js';
import { DUTY_CLASS, MC_MA } from '../../frontend/src/model/classify.js';
import { UNASSIGNED } from '../../shared/domain.js';
import { buildEpisodes } from '../../frontend/src/model/episodes.js';
import { toRecords } from '../../frontend/src/data/records.js';
import { PERSONNEL_HEADERS, STRENGTH_HEADERS, TABS } from '../../shared/tabs.js';
import { personnelValues, strengthValues } from './fixtures.js';

describe('battalion strength', () => {
  test('platoon rows are excluded, so nothing is double-counted', () => {
    const rows = toRecords(
      strengthValues([
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'Company', unit_type: 'Company', total_strength: 136, total_present: 120 },
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: '1', unit_type: 'PLATOON', total_strength: 55, total_present: 51 },
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'COMMANDERS', unit_type: 'COMMAND_ELEMENT', total_strength: 25, total_present: 20 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    expect(battalionStrength(rows, '2026-06-22', 'FPS').accountable).toBe(136);
  });
});

describe('duty counts are of soldiers, not rows', () => {
  test('a soldier listed at both FPS and LPS counts once for the day', () => {
    const rows = toRecords(
      personnelValues([
        { date: '2026-06-22', session: 'FPS', four_d: 'C1110', name: 'A', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'LPS', four_d: 'C1110', name: 'A', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'FPS', four_d: 'C1111', name: 'B', reason_category: 'Att C', reason: 'MC' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );
    expect(dutyCountsOn(rows, '2026-06-22').counts[DUTY_CLASS.ATT_C]).toBe(2);
  });

  test('rows naming no soldier are reported, not dropped', () => {
    const rows = toRecords(
      personnelValues([{ date: '2026-06-22', session: 'FPS', reason_category: 'Att C', reason: 'MC' }]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );
    const result = dutyCountsOn(rows, '2026-06-22');
    expect(result.unattributable).toBe(1);
    expect(result.counts[DUTY_CLASS.ATT_C]).toBe(0);
  });
});

describe('distinct MC / MA on a day', () => {
  const rows = () =>
    toRecords(
      personnelValues([
        { date: '2026-06-22', session: 'FPS', four_d: 'C1110', name: 'A', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'FPS', four_d: 'C1110', name: 'A', reason_category: 'MA', reason: 'MA' },
        { date: '2026-06-22', session: 'FPS', four_d: 'C1111', name: 'B', reason_category: 'MA', reason: 'MA' },
        { date: '2026-06-22', session: 'FPS', four_d: 'C1112', name: 'C', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-21', session: 'FPS', four_d: 'C1113', name: 'D', reason_category: 'Att C', reason: 'MC' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );

  test('a soldier on both MC and MA counts once, and other days are excluded', () => {
    expect(distinctDutyOn(rows(), '2026-06-22', 'FPS', MC_MA)).toBe(3);
  });
});

describe('leaderboard', () => {
  /**
   * Builds episodes for one soldier from start/end date pairs.
   * @param {string} id The soldier's 4D number.
   * @param {Array<Array<string>>} spells Start and end date pairs.
   * @param {string=} category The reason category; defaults to Att C.
   * @returns {Array<!Object>} The soldier's episodes.
   */
  function episodesFor(id, spells, category) {
    const specs = spells.map(([start, end]) => ({
      date: start,
      session: 'FPS',
      company: 'Braves',
      platoon: '1',
      four_d: id,
      name: id,
      reason_category: category || 'Att C',
      start_date: start,
      end_date: end,
      reason: 'MC',
    }));
    return buildEpisodes(toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL));
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
    expect(ranked[0].fourD).toBe('FREQ');
    expect(ranked[0].episodes).toBe(3);
    // The long single absence loses on episodes despite far more days lost, which is the
    // ordering a "most often" question asks for.
    expect(ranked[1].fourD).toBe('LONG');
    expect(ranked[1].daysLost).toBeGreaterThan(ranked[0].daysLost);
  });

  test('counts only the requested duty class', () => {
    const episodes = buildEpisodes(
      toRecords(
        personnelValues([
          { date: '2026-06-01', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
          { date: '2026-06-02', four_d: 'A', name: 'A', reason_category: 'Status', start_date: '2026-06-02', end_date: '2026-06-02', reason: 'LD' },
        ]),
        PERSONNEL_HEADERS,
        TABS.PERSONNEL
      )
    );
    expect(leaderboard(episodes, DUTY_CLASS.ATT_C)).toHaveLength(1);
    expect(leaderboard(episodes, DUTY_CLASS.ATT_C)[0].episodes).toBe(1);
    expect(leaderboard(episodes, DUTY_CLASS.STATUS)).toHaveLength(1);
  });

  test('carries the latest episode date so a stale entry is visible', () => {
    const ranked = leaderboard(
      episodesFor('A', [['2026-06-01', '2026-06-01'], ['2026-07-20', '2026-07-20']]),
      DUTY_CLASS.ATT_C
    );
    expect(ranked[0].lastStart).toBe('2026-07-20');
  });
});

describe('episode counts split volume from headcount', () => {
  /**
   * Builds episodes from terse per-row specs.
   * @param {Array<!Object>} specs Partial personnel rows.
   * @returns {Array<!Object>} The episodes those rows imply.
   */
  function episodesOf(specs) {
    return buildEpisodes(toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL));
  }

  test('a soldier with two separate spells is two episodes but one soldier', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-15', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-15', end_date: '2026-06-15', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany).toEqual([{ key: 'Braves', episodes: 2, soldiers: 1 }]);
    expect(counts.total).toEqual({ episodes: 2, soldiers: 1, perSoldier: 2 });
  });

  test('MC and MA together count both, as the MC / MA page and the Overview tile do', () => {
    const episodes = episodesOf([
      { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
      { date: '2026-06-03', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'MA', start_date: '2026-06-03', end_date: '2026-06-03', reason: 'Dental' },
      { date: '2026-06-04', session: 'FPS', company: 'Braves', platoon: '2', four_d: 'B', name: 'B', reason_category: 'MA', start_date: '2026-06-04', end_date: '2026-06-04', reason: 'Physio' },
    ]);
    expect(episodeCounts(episodes, DUTY_CLASS.ATT_C).total.episodes).toBe(1);
    expect(episodeCounts(episodes, MC_MA).total).toEqual({ episodes: 3, soldiers: 2, perSoldier: 1.5 });
  });

  test('two soldiers in one company are two episodes and two soldiers', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '2', four_d: 'B', name: 'B', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
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
        { date: '2026-06-01', session: 'FPS', company: 'Archer', platoon: 'HQ', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '4', four_d: 'B', name: 'B', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '2', four_d: 'C', name: 'C', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany.map((row) => row.key)).toEqual(['Braves', 'Archer']);
    expect(counts.byPlatoon.map((row) => row.key)).toEqual(['2', '4', 'HQ']);
  });

  test('the battalion soldier count is counted whole, not summed from the company groups', () => {
    // One soldier files once under each of two companies across the range.
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Archer', platoon: '1', four_d: 'MOVER', name: 'Mover', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-20', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'MOVER', name: 'Mover', reason_category: 'Att C', start_date: '2026-06-20', end_date: '2026-06-20', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.byCompany.reduce((sum, row) => sum + row.soldiers, 0)).toBe(2);
    expect(counts.total.soldiers).toBe(1);
    expect(counts.total.episodes).toBe(2);
  });

  test('an episode naming no platoon still counts for the battalion but has no platoon bar', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '', four_d: 'B', name: 'B', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.total.episodes).toBe(2);
    expect(counts.byPlatoon).toEqual([{ key: '1', episodes: 1, soldiers: 1 }]);
  });

  test('only the requested duty class is counted', () => {
    const counts = episodeCounts(
      episodesOf([
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'MC' },
        { date: '2026-06-01', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'B', name: 'B', reason_category: 'Status', start_date: '2026-06-01', end_date: '2026-06-01', reason: 'LD' },
      ]),
      DUTY_CLASS.ATT_C
    );
    expect(counts.total).toEqual({ episodes: 1, soldiers: 1, perSoldier: 1 });
  });
});


/**
 * Builds episodes from terse Personnel Data row specs.
 * @param {Array<!Object>} specs Partial personnel rows.
 * @returns {Array<!Object>} The resulting episodes.
 */
function episodesFrom(specs) {
  return buildEpisodes(toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL));
}

/**
 * One row standing for a whole episode: the start date carries the grouping, so a
 * single parade row with stated start and end dates is one episode.
 * @param {!Object} spec Fields to set on the row.
 * @returns {!Object} A personnel row spec.
 */
function episodeRow(spec) {
  return {
    date: spec.start_date,
    session: 'FPS',
    company: 'Cougar',
    platoon: '4',
    reason_category: 'Att C',
    reason: 'MC',
    ...spec,
  };
}

describe('longMcTrend', () => {
  test('counts each soldier on every day their long MC covers', () => {
    // Soldier A on Att C 1-14 Aug, Soldier B on Att C 5-30 Aug.
    const episodes = episodesFrom([
      episodeRow({ four_d: 'A1', name: 'ALPHA', start_date: '2026-08-01', end_date: '2026-08-14' }),
      episodeRow({ four_d: 'B2', name: 'BRAVO', start_date: '2026-08-05', end_date: '2026-08-30' }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-31', DUTY_CLASS.ATT_C);
    const on = (date) => trend.find((point) => point.date === date).count;
    expect(on('2026-08-02')).toBe(1); // only A
    expect(on('2026-08-06')).toBe(2); // A and B
    expect(on('2026-08-20')).toBe(1); // only B
    expect(on('2026-08-31')).toBe(0); // neither
    expect(trend).toHaveLength(31);
  });

  test('an MC of four days or fewer is never counted', () => {
    const episodes = episodesFrom([
      episodeRow({ four_d: 'S1', name: 'SHORT', start_date: '2026-08-01', end_date: '2026-08-04', num_days: 4 }),
      episodeRow({ four_d: 'L1', name: 'LONG', start_date: '2026-08-01', end_date: '2026-08-05', num_days: 5 }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-05', DUTY_CLASS.ATT_C);
    expect(trend.every((point) => point.count <= 1)).toBe(true);
    expect(trend.find((point) => point.date === '2026-08-03').count).toBe(1); // LONG only
  });

  test('with no stated day count the start-to-end span decides', () => {
    const episodes = episodesFrom([
      episodeRow({ four_d: 'X1', name: 'XRAY', start_date: '2026-08-01', end_date: '2026-08-10' }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-10', DUTY_CLASS.ATT_C);
    expect(trend.find((point) => point.date === '2026-08-07').count).toBe(1);
  });

  test('two overlapping long episodes for one soldier count once', () => {
    const episodes = episodesFrom([
      episodeRow({ four_d: 'D1', name: 'DELTA', start_date: '2026-08-01', end_date: '2026-08-10' }),
      episodeRow({ four_d: 'D1', name: 'DELTA', start_date: '2026-08-05', end_date: '2026-08-20' }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-20', DUTY_CLASS.ATT_C);
    expect(trend.find((point) => point.date === '2026-08-07').count).toBe(1);
  });

  test('a long episode of another duty class does not appear', () => {
    const episodes = episodesFrom([
      episodeRow({
        four_d: 'P1',
        name: 'PERM',
        reason_category: 'Status',
        reason: 'Status',
        start_date: '2026-08-01',
        end_date: '2026-08-30',
      }),
    ]);
    const trend = longMcTrend(episodes, '2026-08-01', '2026-08-30', DUTY_CLASS.ATT_C);
    expect(trend.every((point) => point.count === 0)).toBe(true);
  });
});

describe('longMcRoster', () => {
  test('lists only the long episodes, longest first', () => {
    const episodes = episodesFrom([
      episodeRow({ four_d: 'S1', name: 'SHORT', start_date: '2026-08-01', end_date: '2026-08-04', num_days: 4 }),
      episodeRow({ four_d: 'M1', name: 'MID', start_date: '2026-08-01', end_date: '2026-08-07' }),
      episodeRow({ four_d: 'L1', name: 'LONG', start_date: '2026-08-01', end_date: '2026-08-20' }),
    ]);
    const roster = longMcRoster(episodes, DUTY_CLASS.ATT_C);
    expect(roster.map((row) => row.name)).toEqual(['LONG', 'MID']);
    expect(roster[0].days).toBe(20);
    expect(roster[0].startDate).toBe('2026-08-01');
    expect(roster[0].endDate).toBe('2026-08-20');
  });

  test('carries company and platoon, defaulting platoon to unassigned', () => {
    const episodes = episodesFrom([
      episodeRow({ four_d: 'N1', name: 'NOPLT', platoon: '', start_date: '2026-08-01', end_date: '2026-08-09' }),
    ]);
    const roster = longMcRoster(episodes, DUTY_CLASS.ATT_C);
    expect(roster[0].company).toBe('Cougar');
    expect(roster[0].platoon).toBe(UNASSIGNED);
  });

  test('a soldier with two long episodes gets a row each', () => {
    const episodes = episodesFrom([
      episodeRow({ four_d: 'T1', name: 'TWICE', start_date: '2026-08-01', end_date: '2026-08-10' }),
      episodeRow({ four_d: 'T1', name: 'TWICE', start_date: '2026-09-01', end_date: '2026-09-08' }),
    ]);
    const roster = longMcRoster(episodes, DUTY_CLASS.ATT_C);
    expect(roster).toHaveLength(2);
    expect(roster.map((row) => row.days)).toEqual([10, 8]);
  });
});

describe('absenceParts', () => {
  test('splits the absent classes only, in a fixed order', () => {
    const duty = { counts: { 'Att C': 3, MA: 1, 'Off/Leave': 4, Others: 0, Status: 9, 'Report Sick': 2 } };
    expect(absenceParts(duty)).toEqual([
      { name: 'MC', value: 3 },
      { name: 'MA', value: 1 },
      { name: 'Off / leave', value: 4 },
      { name: 'Other duties', value: 0 },
    ]);
  });
});
