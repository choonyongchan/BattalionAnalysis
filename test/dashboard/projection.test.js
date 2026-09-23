/**
 * Tests for projected strength and the return-to-duty list.
 *
 * The cases worth having: only MC and leave move it, a soldier comes back the day after
 * his stated end date, an absence booked ahead takes him away on its start date, a soldier
 * listed twice is one soldier, an absence with no end date never comes back, and the
 * projection opens on the present figure the parade state reported rather than one
 * recomputed from the lines.
 */

import { describe, expect, test } from 'bun:test';
import { toRecords } from '../../src/data/records.js';
import { PERSONNEL_HEADERS, STRENGTH_HEADERS } from '../../src/data/tabs.js';
import { projectedStrength, returnsToDuty } from '../../src/model/projection.js';

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
 * One company-total strength row on DAY.
 * @param {string} company The company.
 * @param {number} strength Accountable strength.
 * @param {number} present Reported present.
 * @returns {!Object} A Strength Data spec.
 */
function companyRow(company, strength, present) {
  return { date: DAY, session: 'FPS', company, unit_type: 'Company', total_strength: strength, total_present: present };
}

/**
 * One personnel line on DAY.
 * @param {!Object} spec The fields that differ from a default Archer MC line.
 * @returns {!Object} A Personnel Data spec.
 */
function line(spec) {
  return { date: DAY, session: 'FPS', company: 'Archer', reason_category: 'Att C', ...spec };
}

describe('projectedStrength', () => {
  const strength = records(STRENGTH_HEADERS, [companyRow('Archer', 100, 90)]);

  test('opens on the reported present and adds a soldier back the day after his end date', () => {
    const personnel = records(PERSONNEL_HEADERS, [
      line({ four_d: '1001', name: 'A', start_date: '2026-09-21', end_date: '2026-09-23' }),
    ]);
    const { dates, series } = projectedStrength(personnel, strength, DAY, { days: 3 });
    expect(dates).toEqual(['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25']);
    expect(series[0].values).toEqual([90, 90, 91, 91]);
  });

  test('an absence booked ahead takes the soldier away from its start date', () => {
    const personnel = records(PERSONNEL_HEADERS, [
      line({ four_d: '1002', name: 'B', reason_category: 'Off/Leave', start_date: '2026-09-24', end_date: '2026-09-25' }),
    ]);
    expect(projectedStrength(personnel, strength, DAY, { days: 4 }).series[0].values).toEqual([90, 90, 89, 89, 90]);
  });

  test('a soldier listed twice is one soldier, back only when both absences end', () => {
    const personnel = records(PERSONNEL_HEADERS, [
      line({ four_d: '1003', name: 'C', start_date: '2026-09-22', end_date: '2026-09-22' }),
      line({ four_d: '1003', name: 'C', reason_category: 'Off/Leave', start_date: '2026-09-23', end_date: '2026-09-23' }),
    ]);
    expect(projectedStrength(personnel, strength, DAY, { days: 2 }).series[0].values).toEqual([90, 90, 91]);
  });

  test('no end date is never back, and is counted', () => {
    const personnel = records(PERSONNEL_HEADERS, [line({ four_d: '1004', name: 'D', start_date: '2026-09-20' })]);
    const result = projectedStrength(personnel, strength, DAY, { days: 2 });
    expect(result.series[0].values).toEqual([90, 90, 90]);
    expect(result.openEnded).toBe(1);
  });

  test('an open-ended absence counts even when its company filed no strength row', () => {
    // `openEnded` is the disclosure figure saying how much of the projection rests on an
    // absence with no stated return. Counting it only for companies that filed strength
    // would understate exactly the days the reader is being asked to distrust.
    const personnel = records(PERSONNEL_HEADERS, [
      line({ company: 'Braves', four_d: '1010', name: 'J', start_date: '2026-09-20' }),
    ]);
    expect(projectedStrength(personnel, strength, DAY, { days: 2 }).openEnded).toBe(1);
  });

  test('status, report sick, MA and others never move the projection', () => {
    const personnel = records(PERSONNEL_HEADERS, [
      line({ four_d: '1005', name: 'E', reason_category: 'Status', start_date: '2026-09-20', end_date: '2026-09-22' }),
      line({ four_d: '1006', name: 'F', reason_category: 'Report Sick', start_date: '2026-09-22', end_date: '2026-09-22' }),
      line({ four_d: '1008', name: 'H', reason_category: 'MA', start_date: '2026-09-22', end_date: '2026-09-22' }),
      line({ four_d: '1009', name: 'I', reason_category: 'Others', start_date: '2026-09-22', end_date: '2026-09-22' }),
    ]);
    expect(projectedStrength(personnel, strength, DAY, { days: 1 }).series[0].values).toEqual([90, 90]);
  });

  test('never projects more present than the company has', () => {
    const full = records(STRENGTH_HEADERS, [companyRow('Archer', 100, 100)]);
    const personnel = records(PERSONNEL_HEADERS, [line({ four_d: '1007', name: 'G', end_date: '2026-09-22' })]);
    expect(projectedStrength(personnel, full, DAY, { days: 1 }).series[0].values).toEqual([100, 100]);
  });

  test('by company, a company that did not file is a gap in every day', () => {
    const two = records(STRENGTH_HEADERS, [companyRow('Archer', 100, 90), companyRow('Braves', 50, 50)]);
    const result = projectedStrength([], two, DAY, { days: 1, scope: 'companies' });
    expect(result.series.find((series) => series.name === 'Braves').values).toEqual([100, 100]);
    expect(result.series.find((series) => series.name === 'Cougar').values).toEqual([null, null]);
    expect(result.companiesReporting.sort()).toEqual(['Archer', 'Braves']);
  });

  test('the battalion line weighs each company by its strength', () => {
    const two = records(STRENGTH_HEADERS, [companyRow('Archer', 100, 90), companyRow('Braves', 50, 50)]);
    const { dates, series } = projectedStrength([], two, DAY, { days: 0 });
    expect(dates).toEqual([DAY]);
    expect(series[0].values[0]).toBeCloseTo((140 / 150) * 100);
  });
});

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
