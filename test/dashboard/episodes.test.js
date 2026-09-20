/**
 * Tests for collapsing daily snapshots into episodes.
 *
 * Real parade-state data is almost all a single date and a single session, so it
 * cannot exercise this at all — the shapes here are synthetic, built through the real
 * column order by `personnelValues`. What they pin is the distinction the whole feature
 * rests on: a soldier on four days of MC is one episode, not four, and not eight when
 * both FPS and LPS are filed.
 */

import { describe, expect, test } from 'bun:test';
import { buildEpisodes } from '../../src/model/episodes.js';
import { identityOf } from '../../src/model/identity.js';
import { DUTY_CLASS } from '../../src/model/classify.js';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS, TABS } from '../../src/data/tabs.js';
import { personnelValues } from './fixtures.js';

/**
 * Builds episodes from terse row specs.
 * @param {Array<!Object>} specs Partial personnel rows.
 * @returns {Array<!Object>} The resulting episodes.
 */
function episodesFrom(specs) {
  return buildEpisodes(toRecords(personnelValues(specs), PERSONNEL_HEADERS, TABS.PERSONNEL));
}

/**
 * A four-day MC as it appears across four daily parade states.
 * @param {!Object=} overrides Fields to override on every row.
 * @returns {Array<!Object>} Four row specs.
 */
function fourDayMc(overrides) {
  return ['2026-06-20', '2026-06-21', '2026-06-22', '2026-06-23'].map((date) => ({
    date,
    session: 'FPS',
    company: 'Cougar',
    platoon: '4',
    four_d: 'C4211',
    name: 'TEST SOLDIER ALPHA',
    rank: 'REC',
    reason_category: 'Att C',
    start_date: '2026-06-20',
    end_date: '2026-06-23',
    num_days: 4,
    reason: 'MC (Nose bleeding & swollen)',
    ...overrides,
  }));
}

describe('a repeated absence is one episode', () => {
  test('four daily rows sharing a start date collapse to one', () => {
    const episodes = episodesFrom(fourDayMc());
    expect(episodes).toHaveLength(1);
    expect(episodes[0].dutyClass).toBe(DUTY_CLASS.ATT_C);
    expect(episodes[0].observedDays).toBe(4);
    expect(episodes[0].rowCount).toBe(4);
  });

  test('FPS and LPS on one date count as one day, not two', () => {
    const rows = fourDayMc().flatMap((row) => [row, { ...row, session: 'LPS' }]);
    const episodes = episodesFrom(rows);
    expect(episodes).toHaveLength(1);
    expect(episodes[0].rowCount).toBe(8);
    expect(episodes[0].observedDays).toBe(4);
  });

  test('two separate start dates are two episodes', () => {
    const second = fourDayMc({
      date: '2026-07-06',
      start_date: '2026-07-06',
      end_date: '2026-07-07',
      num_days: 2,
    });
    const episodes = episodesFrom([...fourDayMc(), ...second]);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((episode) => episode.startDate)).toEqual(['2026-06-20', '2026-07-06']);
  });

  test('an MC and a status for the same soldier stay separate', () => {
    const status = fourDayMc({
      reason_category: 'Status',
      reason: 'RMJ (Knee Pain)',
      start_date: '2026-06-20',
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
    const episodes = episodesFrom(fourDayMc({ start_date: '', end_date: '', num_days: '' }));
    expect(episodes).toHaveLength(1);
    expect(episodes[0].observedDays).toBe(4);
    expect(episodes[0].daysLostSource).toBe('observed');
  });

  test('a gap of more than a day starts a new episode', () => {
    const first = fourDayMc({ start_date: '', end_date: '', num_days: '' }).slice(0, 2);
    const later = [{ ...first[0], date: '2026-06-30' }];
    const episodes = episodesFrom([...first, ...later]);
    expect(episodes).toHaveLength(2);
    expect(episodes.map((episode) => episode.observedDays)).toEqual([2, 1]);
  });
});

describe('duration is reported, never derived', () => {
  test('the stated day count wins when the message gives one', () => {
    const episode = episodesFrom(fourDayMc())[0];
    expect(episode.statedDays).toBe(4);
    expect(episode.spanDays).toBe(4);
    expect(episode.daysLost).toBe(4);
    expect(episode.daysLostSource).toBe('stated');
    expect(episode.disagreement).toBe(false);
  });

  test('a stated count contradicting its own dates is flagged, not silently resolved', () => {
    const episode = episodesFrom(fourDayMc({ num_days: 2 }))[0];
    expect(episode.statedDays).toBe(2);
    expect(episode.spanDays).toBe(4);
    expect(episode.daysLost).toBe(2);
    expect(episode.disagreement).toBe(true);
  });

  test('the date span is used when no count is stated', () => {
    const episode = episodesFrom(fourDayMc({ num_days: '' }))[0];
    expect(episode.daysLost).toBe(4);
    expect(episode.daysLostSource).toBe('span');
  });

  test('a permanent status (num_days 999) is a flag, not a 999-day episode', () => {
    const episode = episodesFrom(
      fourDayMc({
        reason_category: 'Status',
        reason: 'Permanent Excuse (Throwing Grenades)',
        start_date: '',
        end_date: '',
        num_days: 999,
      })
    )[0];
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
        four_d: 'C1110',
        name: 'TEST SOLDIER',
        reason_category: 'Att C',
        start_date: '2026-06-22',
        end_date: '2026-06-22',
        reason: 'MC',
      },
    ])[0];
    expect(episode.daysLost).toBe(1);
    expect(episode.daysLostSource).toBe('span');
  });
});

describe('soldier identity', () => {
  test('the 4D number is preferred', () => {
    expect(identityOf({ four_d: 'C4211', name: 'IGNORED NAME' })).toEqual({
      key: '4D:C4211',
      source: 'four_d',
    });
  });

  test('a blank 4D falls back to the normalised name', () => {
    expect(identityOf({ four_d: '', name: 'Example Name, Nick' })).toEqual({
      key: 'NAME:EXAMPLE NAME NICK',
      source: 'name',
    });
  });

  test('rows naming nobody are excluded rather than merged together', () => {
    expect(identityOf({ four_d: '', name: '' }).key).toBe('');
    expect(episodesFrom([{ date: '2026-06-22', reason_category: 'Att C', reason: 'MC' }])).toEqual(
      []
    );
  });

  test('a soldier tracked by name across rows stays one soldier', () => {
    const rows = fourDayMc({ four_d: '' });
    rows[2].name = 'Test Soldier Alpha';
    expect(episodesFrom(rows)).toHaveLength(1);
  });
});

describe('episode detail carried through', () => {
  test('symptoms are extracted and de-duplicated across the episode rows', () => {
    const episode = episodesFrom(fourDayMc())[0];
    expect(episode.symptoms).toEqual(['Nose bleed']);
  });

  test('company and platoon are carried from the best-informed row', () => {
    const rows = fourDayMc({ platoon: '' });
    rows[3].platoon = '4';
    const episode = episodesFrom(rows)[0];
    expect(episode.platoon).toBe('4');
    expect(episode.company).toBe('Cougar');
  });
});
