/**
 * One soldier's whole record: the index a search box runs against, and the full report
 * once one is picked.
 *
 * Personnel Data and FormSG both name soldiers, and a soldier can appear in either without
 * appearing in the other — someone may submit a report-sick form without a matching
 * parade-state row yet, or vice versa. `soldierIndex` merges both into one list keyed on
 * `identityKey`, so a search finds a person regardless of which source last mentioned
 * them.
 *
 * Every function here is pure.
 */

import Fuse from 'fuse.js';
import { classify, DUTY_CLASS } from './classify.js';
import { identityKey, identityOf } from './identity.js';
import { platoonOf } from './platoon.js';
import { bucketsFor } from './statusBuckets.js';
import { toIsoDate, toText } from './values.js';

/**
 * Picks the later of two values for a "latest wins" field, skipping blanks.
 * @param {string} current The value held so far.
 * @param {*} candidate A new value to consider.
 * @returns {string} Whichever is non-blank, preferring the candidate.
 */
function preferNonBlank_(current, candidate) {
  const text = toText(candidate);
  return text !== '' ? text : current;
}

/**
 * Builds the search index: one entry per distinct soldier across both sources.
 *
 * Rows are folded in date order so a platoon filled in on a later submission overwrites a
 * blank held from an earlier one — the same "latest wins" rule `episodes.js` uses.
 * @param {Array<!Object>} personnel Normalised Personnel Data records.
 * @param {Array<!Object>} submissions Normalised FormSG submissions from `toSubmissions`.
 * @returns {Array<{key: string, fourD: string, name: string, rank: string, company: string,
 *     platoon: string, platoonInferred: boolean, searchText: string}>} One row per soldier.
 */
export function soldierIndex(personnel, submissions) {
  const bySoldier = new Map();

  const sortedPersonnel = personnel
    .slice()
    .sort((a, b) => toText(toIsoDate(a.date)).localeCompare(toText(toIsoDate(b.date))));

  sortedPersonnel.forEach((row) => {
    const identity = identityOf(row);
    if (identity.key === '') {
      return;
    }
    const entry = bySoldier.get(identity.key) || {
      key: identity.key,
      fourD: '',
      name: '',
      rank: '',
      company: '',
      platoon: '',
    };
    entry.fourD = preferNonBlank_(entry.fourD, row.four_d);
    entry.name = preferNonBlank_(entry.name, row.name);
    entry.rank = preferNonBlank_(entry.rank, row.rank);
    entry.company = preferNonBlank_(entry.company, row.company);
    entry.platoon = preferNonBlank_(entry.platoon, row.platoon);
    bySoldier.set(identity.key, entry);
  });

  (submissions || [])
    .slice()
    .sort((a, b) => toText(a.date).localeCompare(toText(b.date)))
    .forEach((submission) => {
      const key = identityKey(submission.fourD, submission.name);
      if (key === '') {
        return;
      }
      const entry = bySoldier.get(key) || {
        key,
        fourD: '',
        name: '',
        rank: '',
        company: '',
        platoon: '',
      };
      entry.fourD = preferNonBlank_(entry.fourD, submission.fourD);
      entry.name = preferNonBlank_(entry.name, submission.name);
      entry.rank = preferNonBlank_(entry.rank, submission.rank);
      entry.company = preferNonBlank_(entry.company, submission.company);
      bySoldier.set(key, entry);
    });

  return Array.from(bySoldier.values()).map((entry) => {
    const { platoon, inferred } = platoonOf({ platoon: entry.platoon, four_d: entry.fourD });
    return {
      key: entry.key,
      fourD: entry.fourD,
      name: entry.name,
      rank: entry.rank,
      company: entry.company,
      platoon,
      platoonInferred: inferred,
      searchText: [entry.fourD, entry.name].filter((part) => part !== '').join(' '),
    };
  });
}

/**
 * A ranked-reason table: how often each distinct reason appears, most common first.
 * @param {Array<string>} reasons Reason strings, one occurrence per entry.
 * @returns {Array<{reason: string, count: number}>} Reasons ranked by count.
 */
function reasonTable_(reasons) {
  const counts = new Map();
  reasons.forEach((reason) => {
    const text = toText(reason);
    if (text === '') {
      return;
    }
    counts.set(text, (counts.get(text) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/**
 * One soldier's whole record, for the Soldier page and the per-soldier search panels.
 * @param {string} key An identity key from `soldierIndex`.
 * @param {{personnel: Array<!Object>, episodes: Array<!Object>, submissions:
 *     Array<!Object>}} data The loaded dataset's personnel rows, episodes and FormSG
 *     submissions.
 * @returns {?Object} The report, or null when the key matches nothing.
 */
export function soldierReport(key, data) {
  const { personnel, episodes, submissions } = data;

  const ownRows = personnel.filter((row) => identityOf(row).key === key);
  const ownEpisodes = episodes.filter((episode) => episode.key === key);
  const ownSubmissions = (submissions || []).filter(
    (submission) => identityKey(submission.fourD, submission.name) === key
  );

  if (ownRows.length === 0 && ownEpisodes.length === 0 && ownSubmissions.length === 0) {
    return null;
  }

  const identitySource = ownRows.length > 0 ? identityOf(ownRows[0]).source : 'formsg';

  const counts = {
    reportSick: ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.REPORT_SICK).length,
    ma: ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.MA).length,
    mc: ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.ATT_C).length,
    offLeave: ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.OFF_LEAVE).length,
    statuses: ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.STATUS).length,
  };

  // Absences (MC, Off/Leave) read newest-first: a commander asks "how has this soldier
  // been lately", and the most recent episode is the one that answers it.
  const absences = ownEpisodes
    .filter((e) => e.dutyClass === DUTY_CLASS.ATT_C || e.dutyClass === DUTY_CLASS.OFF_LEAVE)
    .slice()
    .sort((a, b) => toText(b.startDate).localeCompare(toText(a.startDate)))
    .map((e) => ({
      dutyClass: e.dutyClass,
      startDate: e.startDate,
      endDate: e.endDate,
      days: e.daysLost,
      daysSource: e.daysLostSource,
      reason: e.reasons.join('; '),
    }));

  // 'Others' rows read the opposite way, oldest-first: they are a narrative of
  // attachments and duties rather than a history of absence, and a narrative reads
  // forward.
  const others = ownRows
    .filter((row) => classify(row) === DUTY_CLASS.OTHERS)
    .slice()
    .sort((a, b) => toText(toIsoDate(a.date)).localeCompare(toText(toIsoDate(b.date))))
    .map((row) => ({
      date: toIsoDate(row.date),
      reason: toText(row.reason),
      location: toText(row.location),
    }));

  const mcReasons = reasonTable_(
    ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.ATT_C).flatMap((e) => e.reasons)
  );
  const reportSickReasons = reasonTable_(
    ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.REPORT_SICK).flatMap((e) => e.reasons)
  );
  const statusReasons = reasonTable_(
    ownEpisodes.filter((e) => e.dutyClass === DUTY_CLASS.STATUS).flatMap((e) => e.reasons.flatMap(bucketsFor))
  );

  const formSg = ownSubmissions
    .slice()
    .sort((a, b) => toText(b.date).localeCompare(toText(a.date)))
    .map((submission) => ({
      date: submission.date,
      type: submission.reportSickType,
      reason: submission.reason,
    }));

  return {
    key,
    identitySource,
    counts,
    absences,
    others,
    reasonTables: { mc: mcReasons, reportSick: reportSickReasons, status: statusReasons },
    formSg,
  };
}

/**
 * Fuzzy-searches the soldier index by 4D or name.
 *
 * A `fuse.js` index over `searchText` and `fourD` separately, weighted so an exact 4D
 * match always outranks a fuzzy name hit — a 4D typed in full is never ambiguous, and a
 * search for one should never be pushed down the list by a loose name match.
 * @param {Array<!Object>} index The result of `soldierIndex`.
 * @param {string} query What the viewer typed.
 * @returns {Array<!Object>} Matching soldiers, best match first; [] for a blank query.
 */
export function findSoldier(index, query) {
  const text = toText(query);
  if (text === '') {
    return [];
  }

  const fuse = new Fuse(index, {
    keys: [
      { name: 'fourD', weight: 3 },
      { name: 'name', weight: 1 },
    ],
    threshold: 0.35,
    ignoreLocation: true,
  });

  return fuse.search(text).map((result) => result.item);
}
