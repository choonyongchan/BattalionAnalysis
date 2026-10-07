/**
 * Recently back: who came off MC or Light Duty in the last day or two.
 *
 * The mirror of `projection.js`. That module lists who is due back; this one lists who has
 * just come back, so a commander can watch for a relapse. MC counts for two days after its
 * end date and Light Duty for one.
 *
 * **A soldier who is back is no longer on the parade.** So the list is read from earlier
 * parades: for each soldier and kind, the latest parade line at or before the date, and the
 * end date that line states. An MC extended on a later parade therefore reads its extended
 * end, and a soldier still listed on the parade itself is not back, whatever his end date says.
 *
 * **No end date means never listed.** A blank end date, or a permanent status, states no
 * day he came off it.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS } from './classify.js';
import { inclusiveDaySpan, isoToUtcMs } from './dates.js';
import { identityOf } from './identity.js';
import { bucketsFor } from './statusBuckets.js';
import { toIsoDate, toText } from './values.js';

/**
 * The kinds the list covers, each with the most days after its end date it stays listed.
 * @type {!Object<string, number>}
 */
const RECENT_WINDOW_DAYS = {
  MC: 2,
  'Light Duty': 1,
};

/**
 * Names the kind a personnel line belongs to, if it is one the list covers.
 * @param {!Object} row A normalised Personnel Data record.
 * @returns {?string} 'MC', 'Light Duty', or null.
 */
function kindOf_(row) {
  const dutyClass = classify(row);
  if (dutyClass === DUTY_CLASS.ATT_C) {
    return 'MC';
  }
  if (dutyClass === DUTY_CLASS.STATUS && bucketsFor(row.reason).includes('Light Duty')) {
    return 'Light Duty';
  }
  return null;
}

/**
 * Whether one line was filed on a later parade than another, by date then session.
 * @param {!Object} a A personnel record.
 * @param {!Object} b Another personnel record.
 * @returns {boolean} True when `a` is the later line.
 */
function isLater_(a, b) {
  const byDate = isoToUtcMs(toIsoDate(a.date)) - isoToUtcMs(toIsoDate(b.date));
  return byDate !== 0 ? byDate > 0 : toText(a.session) > toText(b.session);
}

/**
 * Each soldier's latest MC and Light Duty line on or before a date.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate The parade date the list is for.
 * @returns {!Map<string, {key: string, kind: string, row: !Object}>} Keyed by identity and kind.
 */
function latestLines_(personnelRows, isoDate) {
  const latest = new Map();
  personnelRows.forEach((row) => {
    const date = toIsoDate(row.date);
    const kind = date && date <= isoDate ? kindOf_(row) : null;
    const key = kind ? identityOf(row).key : '';
    if (key === '') {
      return;
    }
    const seen = latest.get(key + '|' + kind);
    if (!seen || isLater_(row, seen.row)) {
      latest.set(key + '|' + kind, { key, kind, row });
    }
  });
  return latest;
}

/**
 * The soldiers who came off MC in the last two days or Light Duty yesterday.
 *
 * Sorted by days back, then kind, then name.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate The parade date the list is for.
 * @returns {Array<{key: string, rank: string, name: string, company: string, platoon: string,
 *     kind: string, reason: string, endedOn: string, daysBack: number}>} One row per soldier
 *     and kind.
 */
export function recentlyReturned(personnelRows, isoDate) {
  const rows = [];
  latestLines_(personnelRows, isoDate).forEach(({ key, kind, row }) => {
    const endedOn = toIsoDate(row.end_date);
    if (!endedOn || toIsoDate(row.date) === isoDate) {
      return;
    }
    const daysBack = inclusiveDaySpan(endedOn, isoDate) - 1;
    if (daysBack < 1 || daysBack > RECENT_WINDOW_DAYS[kind]) {
      return;
    }
    rows.push({
      key,
      rank: toText(row.rank),
      name: toText(row.name),
      company: toText(row.company),
      platoon: toText(row.platoon),
      kind,
      reason: toText(row.reason),
      endedOn,
      daysBack,
    });
  });
  return rows.sort(
    (a, b) => a.daysBack - b.daysBack || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)
  );
}
