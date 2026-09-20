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
  ABSENCE_REASONS,
  battalionStrength,
  companyRates,
  dutyCountsOn,
  employability,
  episodeCounts,
  leaderboard,
  longMcRoster,
  longMcTrend,
  median,
  PARADE_MIX,
  strengthMix,
  topReasonsOn,
  UNASSIGNED,
  unitRates,
} from '../../src/model/metrics.js';
import { DUTY_CLASS } from '../../src/model/classify.js';
import { buildEpisodes } from '../../src/model/episodes.js';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS, STRENGTH_HEADERS, TABS } from '../../src/data/tabs.js';
import { personnelValues, strengthValues } from './fixtures.js';

describe('median', () => {
  test('is the middle value for an odd count', () => {
    expect(median([7, 1, 3])).toBe(3);
  });

  test('averages the two middle values for an even count', () => {
    expect(median([1, 2, 3, 8])).toBe(2.5);
  });

  test('drops nulls before summarising, so a missing value is not read as zero', () => {
    expect(median([null, 4, null, 6])).toBe(5);
  });

  test('is null when nothing remains to summarise', () => {
    expect(median([])).toBeNull();
    expect(median([null, null])).toBeNull();
  });

  test('follows the bulk of the data, not one long outlier', () => {
    expect(median([1, 1, 2, 2, 100])).toBe(2);
  });
});

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

describe('employability', () => {
  test('never drives full duty negative when status exceeds present', () => {
    const strengthRows = toRecords(
      strengthValues([
        { date: '2026-06-22', session: 'FPS', company: 'Braves', unit_type: 'Company', total_strength: 10, total_present: 1 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    const personnelRows = toRecords(
      personnelValues([
        { date: '2026-06-22', session: 'FPS', company: 'Braves', four_d: 'A', name: 'A', reason_category: 'Status', reason: 'LD' },
        { date: '2026-06-22', session: 'FPS', company: 'Braves', four_d: 'B', name: 'B', reason_category: 'Status', reason: 'LD' },
        { date: '2026-06-22', session: 'FPS', company: 'Braves', four_d: 'C', name: 'C', reason_category: 'Status', reason: 'LD' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );

    const now = employability(strengthRows, personnelRows, '2026-06-22', 'FPS');
    expect(now.restricted).toBe(1);
    expect(now.presentFull).toBe(0);
    expect(now.presentFull + now.restricted + now.absent).toBe(now.accountable);
  });

  test('the reason breakdown excludes Report Sick, which is an event not a state', () => {
    // Including it would count a soldier twice in a breakdown that has to sum.
    const classes = ABSENCE_REASONS.map((reason) => reason.dutyClass);
    expect(classes).not.toContain(DUTY_CLASS.REPORT_SICK);
    expect(classes).not.toContain(DUTY_CLASS.STATUS);
    expect(classes).toContain(DUTY_CLASS.ATT_C);
  });
});

describe('company rates', () => {
  test('a big company with more absence can still have the lower rate', () => {
    const strengthRows = toRecords(
      strengthValues([
        { date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1', unit_type: 'PLATOON', total_strength: 100 },
        { date: '2026-06-22', session: 'FPS', company: 'Hercules', platoon: '1', unit_type: 'PLATOON', total_strength: 10 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    const personnelRows = toRecords(
      personnelValues([
        ...['A', 'B', 'C', 'D', 'E'].map((id) => ({
          date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1',
          four_d: id, name: id, reason_category: 'Att C', reason: 'MC',
        })),
        ...['X', 'Y'].map((id) => ({
          date: '2026-06-22', session: 'FPS', company: 'Hercules', platoon: '1',
          four_d: id, name: id, reason_category: 'Att C', reason: 'MC',
        })),
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );

    const rates = companyRates(personnelRows, strengthRows, DUTY_CLASS.ATT_C);
    const braves = rates.filter((row) => row.company === 'Braves')[0];
    const hercules = rates.filter((row) => row.company === 'Hercules')[0];

    expect(braves.days).toBeGreaterThan(hercules.days);
    expect(braves.per100).toBeLessThan(hercules.per100);
    // Sorted by rate, so the worst company is first regardless of its size.
    expect(rates[0].company).toBe('Hercules');
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

describe('top reasons for one parade', () => {
  test('reads only the requested date and class', () => {
    const rows = toRecords(
      personnelValues([
        { date: '2026-06-22', session: 'FPS', four_d: 'A', name: 'A', reason_category: 'Report Sick', reason: 'Fever and cough' },
        { date: '2026-06-19', session: 'FPS', four_d: 'B', name: 'B', reason_category: 'Report Sick', reason: 'Diarrhoea' },
        { date: '2026-06-22', session: 'FPS', four_d: 'C', name: 'C', reason_category: 'Att C', reason: 'MC (Rash)' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );

    const labels = topReasonsOn(rows, '2026-06-22', 'FPS', DUTY_CLASS.REPORT_SICK, 5).map(
      (reason) => reason.label
    );
    expect(labels).toContain('Fever');
    expect(labels).toContain('Cough');
    expect(labels).not.toContain('Diarrhoea');
    expect(labels).not.toContain('Rash / skin');
  });
});

describe('unit rates make companies comparable', () => {
  test('a big company with more MC can have the lower rate', () => {
    const strengthRows = toRecords(
      strengthValues([
        { date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1', unit_type: 'PLATOON', total_strength: 100 },
        { date: '2026-06-22', session: 'FPS', company: 'Hercules', platoon: '1', unit_type: 'PLATOON', total_strength: 10 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    const personnelRows = toRecords(
      personnelValues([
        ...['A', 'B', 'C', 'D'].map((name) => ({ date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1', four_d: name, name, reason_category: 'Att C', reason: 'MC' })),
        { date: '2026-06-22', session: 'FPS', company: 'Hercules', platoon: '1', four_d: 'Z', name: 'Z', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'FPS', company: 'Hercules', platoon: '1', four_d: 'Y', name: 'Y', reason_category: 'Att C', reason: 'MC' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );
    const rates = unitRates(personnelRows, strengthRows, DUTY_CLASS.ATT_C);
    const braves = rates.filter((row) => row.company === 'Braves')[0];
    const hercules = rates.filter((row) => row.company === 'Hercules')[0];
    expect(braves.days).toBe(4);
    expect(hercules.days).toBe(2);
    expect(braves.per100).toBe(4);
    expect(hercules.per100).toBe(20);
    expect(hercules.per100).toBeGreaterThan(braves.per100);
  });

  test('people is a headcount while days is the load', () => {
    const strengthRows = toRecords(
      strengthValues([
        { date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1', unit_type: 'PLATOON', total_strength: 50 },
        { date: '2026-06-23', session: 'FPS', company: 'Braves', platoon: '1', unit_type: 'PLATOON', total_strength: 50 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    const personnelRows = toRecords(
      personnelValues([
        // One soldier out on both parades: two person-days, one person.
        { date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-23', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', reason: 'MC' },
        // A second soldier out once.
        { date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '1', four_d: 'B', name: 'B', reason_category: 'Att C', reason: 'MC' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );
    const platoon = unitRates(personnelRows, strengthRows, DUTY_CLASS.ATT_C).filter(
      (row) => row.platoon === '1'
    )[0];
    expect(platoon.days).toBe(3);
    expect(platoon.people).toBe(2);
  });

  test('an outlier is flagged by z-score, not by raw count', () => {
    const strengthRows = toRecords(
      strengthValues(
        ['1', '2', '3', '4'].map((platoon) => ({ date: '2026-06-22', session: 'FPS', company: 'Braves', platoon, unit_type: 'PLATOON', total_strength: 50 }))
      ),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    const specs = [];
    ['1', '2', '3'].forEach((platoon) =>
      specs.push({ date: '2026-06-22', session: 'FPS', company: 'Braves', platoon, four_d: 'P' + platoon, name: 'P' + platoon, reason_category: 'Att C', reason: 'MC' })
    );
    for (let i = 0; i < 25; i += 1) {
      specs.push({ date: '2026-06-22', session: 'FPS', company: 'Braves', platoon: '4', four_d: 'X' + i, name: 'X' + i, reason_category: 'Att C', reason: 'MC' });
    }
    const rates = unitRates(toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL), strengthRows, DUTY_CLASS.ATT_C);
    const flagged = rates.filter((row) => row.isOutlier).map((row) => row.platoon);
    expect(flagged).toEqual(['4']);
  });

  test('a platoon with unusually LITTLE MC is not flagged as a cluster', () => {
    // One-tailed on purpose: "is the MC localised here" asks about units losing more days
    // than the battalion. A platoon losing fewer would otherwise appear in a list the
    // dashboard captions "worth asking the company about".
    const strengthRows = toRecords(
      strengthValues(
        ['1', '2', '3', '4'].map((platoon) => ({ date: '2026-06-22', session: 'FPS', company: 'Braves', platoon, unit_type: 'PLATOON', total_strength: 50 }))
      ),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
    const specs = [];
    ['1', '2', '3'].forEach((platoon) => {
      for (let i = 0; i < 12; i += 1) {
        specs.push({ date: '2026-06-22', session: 'FPS', company: 'Braves', platoon, four_d: platoon + '-' + i, name: platoon + '-' + i, reason_category: 'Att C', reason: 'MC' });
      }
    });
    const rates = unitRates(toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL), strengthRows, DUTY_CLASS.ATT_C);
    const quiet = rates.filter((row) => row.platoon === '4')[0];
    expect(quiet.days).toBe(0);
    expect(quiet.z).toBeLessThan(-2);
    expect(quiet.isOutlier).toBe(false);
  });
});

describe('accountable strength split by the sheet categories', () => {
  const strength = () =>
    toRecords(
      strengthValues([
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'Company', unit_type: 'Company', total_strength: 100, total_present: 90 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );
  const people = (specs) => toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL);
  const filed = (fourD, category, overrides) => ({
    date: '2026-06-22',
    session: 'FPS',
    company: 'Cougar',
    platoon: '1',
    four_d: fourD,
    name: fourD,
    reason_category: category,
    reason: category,
    ...overrides,
  });
  const countOf = (mix, label) => mix.slices.filter((slice) => slice.label === label)[0].count;

  test('the slices sum to accountable strength', () => {
    const mix = strengthMix(
      strength(),
      people([filed('A', 'Att C'), filed('B', 'Status'), filed('C', 'MA'), filed('D', 'Others')]),
      '2026-06-22',
      'FPS'
    );
    expect(mix.slices.reduce((sum, slice) => sum + slice.count, 0)).toBe(100);
    expect(mix.accountable).toBe(100);
  });

  test('the slices keep their fixed order, so a category keeps its colour', () => {
    const mix = strengthMix(strength(), people([]), '2026-06-22', 'FPS');
    expect(mix.slices.map((slice) => slice.label)).toEqual(PARADE_MIX.map((entry) => entry.label));
  });

  test('full duty is the residual, not a figure of its own', () => {
    const mix = strengthMix(
      strength(),
      people([filed('A', 'Att C'), filed('B', 'MA')]),
      '2026-06-22',
      'FPS'
    );
    expect(countOf(mix, 'Full duty')).toBe(98);
    expect(mix.named).toBe(2);
  });

  // The case a naive count gets wrong: Archer files twelve soldiers under two or three
  // categories on one date, and counting rows would push the parts past the whole.
  test('a soldier filed under three categories is counted once, under the first', () => {
    const mix = strengthMix(
      strength(),
      people([filed('A', 'Status'), filed('A', 'MA'), filed('A', 'Report Sick')]),
      '2026-06-22',
      'FPS'
    );
    expect(mix.named).toBe(1);
    expect(countOf(mix, 'MA')).toBe(1);
    expect(countOf(mix, 'Att B / LD')).toBe(0);
    expect(countOf(mix, 'Report sick')).toBe(0);
  });

  test('MC outranks every other category the same soldier is filed under', () => {
    const mix = strengthMix(
      strength(),
      people([filed('A', 'Others'), filed('A', 'Att C')]),
      '2026-06-22',
      'FPS'
    );
    expect(countOf(mix, 'Att C')).toBe(1);
    expect(countOf(mix, 'Duty / course')).toBe(0);
  });

  test('FPS and LPS rows for one soldier are one soldier', () => {
    const mix = strengthMix(
      strength(),
      people([filed('A', 'Att C'), filed('A', 'Att C', { session: 'LPS' })]),
      '2026-06-22',
      'FPS'
    );
    expect(countOf(mix, 'Att C')).toBe(1);
  });

  test('the strength line disagreeing is reported, not reconciled away', () => {
    // The strength line says 90 present; this breakdown puts 99 on parade, because one
    // filed absence is all it knows about. Both figures reach the screen.
    const mix = strengthMix(strength(), people([filed('A', 'Att C')]), '2026-06-22', 'FPS');
    expect(mix.presentLine).toBe(90);
    expect(mix.here).toBe(99);
    expect(mix.parity).toBe(9);
  });

  test('more soldiers filed than the strength lines account for is clamped and reported', () => {
    const specs = [];
    for (let index = 0; index < 120; index += 1) {
      specs.push(filed('X' + index, 'Att C'));
    }
    const mix = strengthMix(strength(), people(specs), '2026-06-22', 'FPS');
    expect(countOf(mix, 'Full duty')).toBe(0);
    expect(mix.overflow).toBe(20);
  });

  test('an unrecognised category is counted, not passed off as full duty', () => {
    const mix = strengthMix(strength(), people([filed('A', 'Detention')]), '2026-06-22', 'FPS');
    expect(mix.unknown).toBe(1);
    expect(mix.named).toBe(0);
  });
});

describe('a platoon rate is drawn over the platoon roll only', () => {
  const strengthRows = () =>
    toRecords(
      strengthValues([
        ...['1', '2', '3', '4', 'HQ'].map((platoon) => ({ date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon, unit_type: 'PLATOON', total_strength: 50 })),
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'COMMANDERS', unit_type: 'COMMAND_ELEMENT', total_strength: 25 },
      ]),
      STRENGTH_HEADERS,
      TABS.STRENGTH
    );

  test('the command element and the rows naming no platoon get no cell', () => {
    const personnelRows = toRecords(
      personnelValues([
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: 'COMMANDERS', four_d: 'B', name: 'B', reason_category: 'Att C', reason: 'MC' },
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: '', four_d: 'C', name: 'C', reason_category: 'Att C', reason: 'MC' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );
    const rates = unitRates(personnelRows, strengthRows(), DUTY_CLASS.ATT_C);
    expect(rates.map((row) => row.platoon)).toEqual(['1', '2', '3', '4', 'HQ']);
    expect(rates.reduce((sum, row) => sum + row.days, 0)).toBe(1);
  });

  test('the command element leaves the denominator too, so the rate is over platoons', () => {
    const personnelRows = toRecords(
      personnelValues([
        { date: '2026-06-22', session: 'FPS', company: 'Cougar', platoon: '1', four_d: 'A', name: 'A', reason_category: 'Att C', reason: 'MC' },
      ]),
      PERSONNEL_HEADERS,
      TABS.PERSONNEL
    );
    const rates = unitRates(personnelRows, strengthRows(), DUTY_CLASS.ATT_C);
    // 250 pax-days across the five platoons, not 275 with the command element folded in.
    expect(rates.reduce((sum, row) => sum + row.paxDays, 0)).toBe(250);
    expect(rates.filter((row) => row.platoon === '1')[0].per100).toBe(2);
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
