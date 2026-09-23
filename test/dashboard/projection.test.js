/**
 * Tests for the return-to-duty list.
 *
 * The cases worth having: only MC and leave are listed, a soldier comes back the day after
 * his stated end date, a soldier listed twice is one soldier back only when both absences
 * end, and an absence with no end date is listed last with no day back.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS } from '../../src/data/tabs.js';
import { returnsToDuty } from '../../src/model/projection.js';

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
 * One personnel line on DAY.
 * @param {!Object} spec The fields that differ from a default Archer MC line.
 * @returns {!Object} A Personnel Data spec.
 */
function line(spec) {
  return { date: DAY, session: 'FPS', company: 'Archer', reason_category: 'Att C', ...spec };
}

describe('returnsToDuty', () => {
  test('lists each absent soldier once with the day he is back, soonest first, open-ended last', () => {
    const personnel = records(PERSONNEL_HEADERS, [
      line({ four_d: '1', name: 'LATE', end_date: '2026-09-30' }),
      line({ four_d: '2', name: 'OPEN' }),
      line({ four_d: '3', name: 'SOON', start_date: '2026-09-20', end_date: '2026-09-22' }),
      line({ four_d: '3', name: 'SOON', reason_category: 'Off/Leave', start_date: '2026-09-22', end_date: '2026-09-22' }),
      line({ four_d: '5', name: 'CLINIC', reason_category: 'MA', end_date: '2026-09-22' }),
      line({ four_d: '4', name: 'STATUS', reason_category: 'Status', end_date: '2026-09-23' }),
    ]);
    const rows = returnsToDuty(personnel, DAY);
    expect(rows.map((row) => [row.name, row.backOn])).toEqual([
      ['SOON', '2026-09-23'],
      ['LATE', '2026-10-01'],
      ['OPEN', null],
    ]);
    expect(rows[0].from).toBe('2026-09-20');
  });
});
