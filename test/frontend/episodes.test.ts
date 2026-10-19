/**
 * Tests for collapsing daily rows into episodes: four days of MC is one episode, not four,
 * and not eight when both FPS and LPS are filed.
 */

import { describe, expect, test } from 'bun:test';
import { activeWithin, buildEpisodes, startsByWeekday } from '../../frontend/src/model/episodes.ts';
import { identityOf } from '../../shared/identity.ts';
import { DUTY_CLASS } from '../../frontend/src/model/classify.ts';
import type { PersonnelRow } from '../../shared/dashboard.ts';
import { episode as episodeOf, personnelRows } from './fixtures.ts';

/** Episodes from terse row specs. */
function episodesFrom(specs: Partial<PersonnelRow>[]) {
  return buildEpisodes(personnelRows(specs));
}

/** A four-day MC as it appears across four daily parade states. */
function fourDayMc(overrides: Partial<PersonnelRow> = {}): PersonnelRow[] {
  return personnelRows(['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23'].map((date) => ({
    date,
    session: 'FPS',
    company: 'Cougar',
    platoon: '4',
    fourD: 'C4211',
    name: 'TEST SOLDIER ALPHA',
    rank: 'REC',
    reasonCategory: 'Att C',
    startDate: '2026-06-20',
    endDate: '2026-06-23',
    numDays: 4,
    reason: 'MC (Nose bleeding & swollen)',
    ...overrides,
  })));
}

describe('a repeated absence is one episode', () => {
  test('four daily rows sharing a start date collapse to one', () => {
    const episodes = episodesFrom(fourDayMc());
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.dutyClass).toBe(DUTY_CLASS.ATT_C);
    expect(episodes[0]!.observedDays).toBe(4);
    expect(episodes[0]!.rowCount).toBe(4);
  });

  test('FPS and LPS on one date count as one day, not two', () => {
    const rows = fourDayMc().flatMap((row) => [row, { ...row, session: 'LPS' as const }]);
    const episodes = episodesFrom(rows);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.rowCount).toBe(8);
    expect(episodes[0]!.observedDays).toBe(4);
  });

  test('two separate start dates are two episodes', () => {
    const second = fourDayMc({
      date: '2026-07-06',
      startDate: '2026-07-06',
      endDate: '2026-07-07',
      numDays: 2,
    });
    const episodes = episodesFrom([...fourDayMc(), ...second]);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((episode) => episode.startDate)).toEqual(['2026-06-20', '2026-07-06']);
  });

  test('an MC and a status for the same soldier stay separate', () => {
    const status = fourDayMc({
      reasonCategory: 'Status',
      reason: 'RMJ (Knee Pain)',
      startDate: '2026-06-20',
    });
    const episodes = episodesFrom([...fourDayMc(), ...status]);
    expect(episodes.map((episode) => episode.dutyClass).sort()).toEqual([
      DUTY_CLASS.ATT_C,
      DUTY_CLASS.STATUS,
    ]);
  });
});

describe('rows that state no start date', () => {
  test('consecutive parade dates group into one episode', () => {
    const episodes = episodesFrom(fourDayMc({ startDate: null, endDate: null, numDays: null }));
    expect(episodes).toHaveLength(1);
    expect(episodes[0]!.observedDays).toBe(4);
    expect(episodes[0]!.daysLostSource).toBe('observed');
  });

  test('a gap of more than a day starts a new episode', () => {
    const first = fourDayMc({ startDate: null, endDate: null, numDays: null }).slice(0, 2);
    const later = [{ ...first[0]!, date: '2026-06-30' }];
    const episodes = episodesFrom([...first, ...later]);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((episode) => episode.observedDays)).toEqual([2, 1]);
  });
});

describe('duration is reported, never derived', () => {
  test('the stated day count wins when the message gives one', () => {
    const episode = episodesFrom(fourDayMc())[0]!;
    expect(episode.statedDays).toBe(4);
    expect(episode.spanDays).toBe(4);
    expect(episode.daysLost).toBe(4);
    expect(episode.daysLostSource).toBe('stated');
    expect(episode.disagreement).toBe(false);
  });

  test('a stated count contradicting its own dates is flagged, not silently resolved', () => {
    const episode = episodesFrom(fourDayMc({ numDays: 2 }))[0]!;
    expect(episode.statedDays).toBe(2);
    expect(episode.spanDays).toBe(4);
    expect(episode.daysLost).toBe(2);
    expect(episode.disagreement).toBe(true);
  });

  test('the date span is used when no count is stated', () => {
    const episode = episodesFrom(fourDayMc({ numDays: null }))[0]!;
    expect(episode.daysLost).toBe(4);
    expect(episode.daysLostSource).toBe('span');
  });

  test('a permanent status (numDays 999) is a flag, not a 999-day episode', () => {
    const episode = episodesFrom(
      fourDayMc({
        reasonCategory: 'Status',
        reason: 'Permanent Excuse (Throwing Grenades)',
        startDate: null,
        endDate: null,
        numDays: 999,
      })
    )[0]!;
    expect(episode.permanent).toBe(true);
    expect(episode.statedDays).toBeNull();
    expect(episode.daysLost).toBe(4);
    expect(episode.daysLostSource).toBe('observed');
    expect(episode.disagreement).toBe(false);
  });

  test('a one-day MC counts as one day, not zero', () => {
    const episode = episodesFrom([
      {
        date: '2026-06-22',
        session: 'FPS',
        fourD: 'C1110',
        name: 'TEST SOLDIER',
        reasonCategory: 'Att C',
        startDate: '2026-06-22',
        endDate: '2026-06-22',
        reason: 'MC',
      },
    ])[0]!;
    expect(episode.daysLost).toBe(1);
    expect(episode.daysLostSource).toBe('span');
  });
});

describe('soldier identity', () => {
  test('the 4D number is preferred', () => {
    expect(identityOf({ fourD: 'C4211', name: 'IGNORED NAME' })).toEqual({
      key: '4D:C4211',
      source: 'fourD',
    });
  });

  test('a blank 4D falls back to the normalised name', () => {
    expect(identityOf({ fourD: '', name: 'Example Name, Nick' })).toEqual({
      key: 'NAME:EXAMPLE NAME NICK',
      source: 'name',
    });
  });

  test('rows naming nobody are excluded rather than merged together', () => {
    expect(identityOf({ fourD: '', name: '' }).key).toBe('');
    expect(episodesFrom([{ date: '2026-06-22', reasonCategory: 'Att C', reason: 'MC' }])).toEqual(
      []
    );
  });

  test('a soldier tracked by name across rows stays one soldier', () => {
    const rows = fourDayMc({ fourD: '' });
    rows[2]!.name = 'Test Soldier Alpha';
    expect(episodesFrom(rows)).toHaveLength(1);
  });
});

describe('episode detail carried through', () => {
  test('symptoms are extracted and de-duplicated across the episode rows', () => {
    const episode = episodesFrom(fourDayMc())[0]!;
    expect(episode.symptoms).toEqual(['Nose bleed']);
  });

  test('company and platoon are carried from the best-informed row', () => {
    const rows = fourDayMc({ platoon: '' });
    rows[3]!.platoon = '4';
    const episode = episodesFrom(rows)[0]!;
    expect(episode.platoon).toBe('4');
    expect(episode.company).toBe('Cougar');
  });
});

describe('activeWithin', () => {
  const listedOn = (paradeDates: string[]) => episodeOf({ paradeDates });

  test('an episode begun before the range and still listed inside it is active', () => {
    expect(activeWithin(listedOn(['2026-09-16', '2026-09-22', '2026-09-28']), '2026-09-28', '2026-09-28')).toBe(true);
  });

  test('an episode listed only after the range is not active', () => {
    expect(activeWithin(listedOn(['2026-09-29', '2026-09-30']), '2026-09-01', '2026-09-28')).toBe(false);
  });

  test('an episode listed only before the range is not active', () => {
    expect(activeWithin(listedOn(['2026-09-14', '2026-09-15']), '2026-09-20', '2026-09-28')).toBe(false);
  });

  test('an undated perm status counts on the parades that list it', () => {
    const [perm] = episodesFrom([
      { date: '2026-09-28', session: 'FPS', name: 'CAI YICHEN', reasonCategory: DUTY_CLASS.STATUS, reason: 'Perm Excuse FLEGS', startDate: null, endDate: null },
    ]);
    expect(activeWithin(perm!, '2026-09-28', '2026-09-28')).toBe(true);
  });
});

describe('startsByWeekday', () => {
  test('counts starts per weekday, and those on a Monday, a Friday or beside a holiday', () => {
    const episodes = [
      episodeOf({ dutyClass: DUTY_CLASS.ATT_C, startDate: '2026-10-05' }), // Mon
      episodeOf({ dutyClass: DUTY_CLASS.ATT_C, startDate: '2026-10-09' }), // Fri
      episodeOf({ dutyClass: DUTY_CLASS.ATT_C, startDate: '2026-10-07' }), // Wed, day before a holiday
      episodeOf({ dutyClass: DUTY_CLASS.ATT_C, startDate: '2026-10-13' }), // Tue
      episodeOf({ dutyClass: DUTY_CLASS.STATUS, startDate: '2026-10-05' }),
    ];
    expect(startsByWeekday(episodes, DUTY_CLASS.ATT_C, [{ date: '2026-10-08', name: 'Holiday' }])).toEqual({
      counts: [1, 1, 1, 0, 1, 0, 0],
      nextToBreak: 3,
      total: 4,
    });
  });
});
