/**
 * Tests for the recently-back list.
 *
 * The cases worth having: MC is listed one and two days after its end and Light Duty one,
 * only MC and Light Duty count, an MC extended on a later parade reads its extended end, and
 * a soldier still listed on the parade itself is not back.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS } from '../../src/data/tabs.js';
import { recentlyReturned } from '../../src/model/recentReturns.js';

const DAY = '2026-09-22';

/**
 * Builds normalised records for a tab from column-keyed row specs.
 * @param {string[]} headers The tab's headers.
 * @param {Array<!Object>} specs Partial records; unlisted headers read as ''.
 * @returns {Array<!Object>} Normalised records.
 */
function records(headers, specs) {
  const values = [headers.slice(), ...specs.map((spec) => headers.map((header) => (header in spec ? spec[header] : '')))];
  return toRecords(values, headers, 'test');
}

/**
 * One personnel line, filed on its end date unless the spec says otherwise.
 * @param {!Object} spec The fields that differ from a default Archer MC line.
 * @returns {!Object} A Personnel Data spec.
 */
function line(spec) {
  return { date: spec.end_date || DAY, session: 'FPS', company: 'Archer', reason_category: 'Att C', ...spec };
}

/**
 * Runs the list over some lines and names each row with its kind and days back.
 * @param {Array<!Object>} specs Personnel Data specs.
 * @returns {Array<Array<*>>} [name, kind, daysBack] per listed row.
 */
function listed(specs) {
  return recentlyReturned(records(PERSONNEL_HEADERS, specs.map(line)), DAY).map((row) => [
    row.name,
    row.kind,
    row.daysBack,
  ]);
}

describe('recentlyReturned', () => {
  test('lists MC one and two days after its end, and not on its end day or the third day', () => {
    expect(
      listed([
        { four_d: '1', name: 'ONE', end_date: '2026-09-21' },
        { four_d: '2', name: 'TWO', end_date: '2026-09-20' },
        { four_d: '3', name: 'THREE', end_date: '2026-09-19' },
        { four_d: '4', name: 'TODAY', end_date: '2026-09-22', date: '2026-09-21' },
      ])
    ).toEqual([
      ['ONE', 'MC', 1],
      ['TWO', 'MC', 2],
    ]);
  });

  test('lists Light Duty only the day after its end, and no other status', () => {
    const status = { reason_category: 'Status' };
    expect(
      listed([
        { ...status, four_d: '1', name: 'LD', reason: 'LD 5 DAYS', end_date: '2026-09-21' },
        { ...status, four_d: '2', name: 'LD OLD', reason: 'Light Duty', end_date: '2026-09-20' },
        { ...status, four_d: '3', name: 'RMJ', reason: 'Excuse RMJ', end_date: '2026-09-21' },
        { ...status, four_d: '4', name: 'PERM', reason: 'PERM LD' },
      ])
    ).toEqual([['LD', 'Light Duty', 1]]);
  });

  test('leaves out MA, leave and an MC with no end date', () => {
    expect(
      listed([
        { four_d: '1', name: 'MA', reason_category: 'MA', end_date: '2026-09-21' },
        { four_d: '2', name: 'LEAVE', reason_category: 'Off/Leave', end_date: '2026-09-21' },
        { four_d: '3', name: 'OPEN', date: '2026-09-21' },
      ])
    ).toEqual([]);
  });

  test('reads the end date from the latest parade, so an extended MC is not back', () => {
    expect(
      listed([
        { four_d: '1', name: 'EXTENDED', end_date: '2026-09-21', date: '2026-09-20' },
        { four_d: '1', name: 'EXTENDED', end_date: '2026-09-24', date: '2026-09-21' },
      ])
    ).toEqual([]);
  });

  test('does not list a soldier still on the parade itself, whatever his end date says', () => {
    expect(listed([{ four_d: '1', name: 'STALE', end_date: '2026-09-21', date: DAY }])).toEqual([]);
  });
});
