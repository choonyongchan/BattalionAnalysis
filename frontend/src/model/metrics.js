/**
 * The numbers the dashboard puts on screen.
 *
 * Three rules run through this module, each learned from the data rather than assumed:
 *
 * **Counts are of soldiers, not rows.** A company that files both FPS and LPS lists the
 * same absentee twice, so every headcount deduplicates on identity within a date.
 *
 * **Comparisons are counts, not rates.** Commanders read whole soldiers; a per-100 rate
 * is never shown, so every cross-unit comparison is a count of distinct soldiers.
 *
 * **A missing company is stated, never absorbed.** If five of six companies have filed,
 * the battalion total is a total of five companies and the dashboard says so. A headline
 * that quietly omits a company is worse than no headline.
 *
 * Every function here is pure.
 */

import { classify, DUTY_CLASS, isAbsent, isDuty, isRestricted } from './classify.js';
import { identityOf } from '../../../shared/identity.js';
import { COMPANIES, PLATOONS, UNASSIGNED, UNIT_TYPE_COMPANY } from '../../../shared/domain.js';
import { inclusiveDaySpan } from '../../../shared/dates.js';
import { toIsoDate, toNumber, toText } from '../../../shared/values.js';
import { eachDay, withinRange } from './dateRange.js';

/**
 * Sums a list of numbers, ignoring nulls.
 * @param {Array<?number>} values Values to sum.
 * @returns {number} The sum; 0 when the list is empty or all null.
 */
function sum_(values) {
  return values.reduce((total, value) => total + (value === null ? 0 : value), 0);
}

/**
 * Lists the distinct parade dates present in a set of rows, most recent last.
 * @param {Array<!Object>} rows Rows carrying a `date` field.
 * @returns {string[]} Sorted ISO dates.
 */
export function datesPresent(rows) {
  const dates = new Set();
  rows.forEach((row) => {
    const date = toIsoDate(row.date);
    if (date) {
      dates.add(date);
    }
  });
  return Array.from(dates).sort();
}

/**
 * Battalion strength for one date and session.
 *
 * Sums only `unit_type === 'Company'` rows. Summing platoon rows instead would
 * double-count against the company total and would silently drop any company that files
 * no platoon breakdown — Hercules files one line in the samples.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records.
 * @param {string} isoDate Parade date.
 * @param {string} session 'FPS' or 'LPS'.
 * @returns {!Object} Accountable and present strength, plus which companies reported.
 */
export function battalionStrength(strengthRows, isoDate, session) {
  const rows = strengthRows.filter(
    (row) =>
      toIsoDate(row.date) === isoDate &&
      toText(row.session) === session &&
      toText(row.unit_type) === UNIT_TYPE_COMPANY
  );

  const byCompany = new Map();
  rows.forEach((row) => {
    byCompany.set(toText(row.company), {
      company: toText(row.company),
      strength: toNumber(row.total_strength),
      present: toNumber(row.total_present),
    });
  });

  const reported = Array.from(byCompany.values());
  const accountable = sum_(reported.map((entry) => entry.strength));
  const present = sum_(reported.map((entry) => entry.present));
  const reporting = reported.map((entry) => entry.company);

  return {
    date: isoDate,
    session,
    accountable,
    present,
    absent: accountable - present,
    percentPresent: accountable > 0 ? (present / accountable) * 100 : null,
    byCompany: reported.sort((a, b) => a.company.localeCompare(b.company)),
    companiesReporting: reporting,
    companiesMissing: COMPANIES.filter((company) => !reporting.includes(company)),
    isComplete: reporting.length === COMPANIES.length,
  };
}

/**
 * Counts distinct soldiers per duty class on one date.
 *
 * Deduplicates on identity so a soldier listed in both FPS and LPS counts once. Rows
 * with neither a 4D nor a name cannot be attributed to a soldier and are counted
 * separately as `unattributable` rather than dropped.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {?string=} session Session to restrict to, or null for both.
 * @returns {!Object} Per-class distinct soldier counts and totals.
 */
export function dutyCountsOn(personnelRows, isoDate, session) {
  const rows = personnelRows.filter(
    (row) => toIsoDate(row.date) === isoDate && (!session || toText(row.session) === session)
  );

  const seen = new Map();
  let unattributable = 0;
  rows.forEach((row) => {
    const dutyClass = classify(row);
    const identity = identityOf(row);
    if (identity.key === '') {
      unattributable += 1;
      return;
    }
    const bucket = seen.get(dutyClass) || new Set();
    bucket.add(identity.key);
    seen.set(dutyClass, bucket);
  });

  const counts = {};
  let absentTotal = 0;
  let restrictedTotal = 0;
  Object.values(DUTY_CLASS).forEach((dutyClass) => {
    const size = (seen.get(dutyClass) || new Set()).size;
    counts[dutyClass] = size;
    if (isAbsent(dutyClass)) {
      absentTotal += size;
    }
    if (isRestricted(dutyClass)) {
      restrictedTotal += size;
    }
  });

  return { date: isoDate, session: session || null, counts, absentTotal, restrictedTotal, unattributable };
}

/**
 * Counts distinct soldiers in one or more duty classes on one date.
 *
 * Unlike summing `dutyCountsOn` per class, a soldier listed under two of the classes (for
 * example an MC and an MA on the same day) counts once. Rows that cannot be attributed to
 * a soldier are skipped, as in `dutyCountsOn`.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {string} isoDate Parade date.
 * @param {?string} session Session to restrict to, or null for both.
 * @param {string|!Array<string>} dutyClass Duty class(es) to count, from DUTY_CLASS.
 * @returns {number} Distinct soldier count.
 */
export function distinctDutyOn(personnelRows, isoDate, session, dutyClass) {
  const keys = new Set();
  personnelRows
    .filter(
      (row) =>
        toIsoDate(row.date) === isoDate &&
        (!session || toText(row.session) === session) &&
        isDuty(dutyClass, classify(row))
    )
    .forEach((row) => {
      const { key } = identityOf(row);
      if (key !== '') {
        keys.add(key);
      }
    });
  return keys.size;
}

/**
 * The length of an episode in days, for the long-MC test.
 *
 * The stated day count wins when the message gave one, exactly as the rest of the Att
 * C section reads duration. With no stated count it is the start-to-end span, where a
 * missing `start_date` has already fallen back to the first parade date the soldier
 * was seen absent and a missing `end_date` to the last.
 * @param {!Object} episode An episode from `buildEpisodes`.
 * @returns {number} The length in whole days.
 */
function episodeDays_(episode) {
  if (episode.statedDays !== null && episode.statedDays > 0) {
    return episode.statedDays;
  }
  return inclusiveDaySpan(episode.startDate, episode.endDate);
}

/**
 * The long episodes of one duty class: length greater than `minDays`.
 * @param {Array<!Object>} episodes Episodes to filter.
 * @param {string|!Array<string>} dutyClass Duty class(es) to keep, from DUTY_CLASS.
 * @param {number} minDays Length a long episode must exceed.
 * @returns {Array<!Object>} The matching episodes.
 */
function longEpisodes_(episodes, dutyClass, minDays) {
  return episodes.filter(
    (episode) =>
      isDuty(dutyClass, episode.dutyClass) &&
      episode.startDate &&
      episode.endDate &&
      episodeDays_(episode) > minDays
  );
}

/**
 * How many distinct soldiers are on a long episode of `dutyClass` on each calendar day.
 *
 * A long MC is one that lasts more than `minDays` days. A soldier is counted on every
 * day their episode covers, `[startDate, endDate]` inclusive, so a fortnight's MC adds
 * one to fourteen days of the line. Two overlapping long episodes for the same soldier
 * still count once, because the question is how many people are away, not how many
 * certificates are open.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {?string} fromIso First day to report, ISO 'yyyy-MM-dd'.
 * @param {?string} toIso Last day to report, ISO 'yyyy-MM-dd'.
 * @param {string|!Array<string>} dutyClass Duty class(es) to trend, from DUTY_CLASS.
 * @param {number=} minDays Length a long episode must exceed; defaults to 4.
 * @returns {Array<{date: string, count: number}>} One entry per day, oldest first.
 */
export function longMcTrend(episodes, fromIso, toIso, dutyClass, minDays = 4) {
  const long = longEpisodes_(episodes, dutyClass, minDays);
  return eachDay(fromIso, toIso).map((day) => {
    const soldiers = new Set();
    long.forEach((episode) => {
      if (withinRange(day, episode.startDate, episode.endDate)) {
        soldiers.add(episode.key);
      }
    });
    return { date: day, count: soldiers.size };
  });
}

/**
 * One row per long episode of `dutyClass`, longest first.
 *
 * One person with two long episodes appears twice: each long MC is its own row, since
 * the table answers "which are the longest MCs, and whose". Ties break on the earlier
 * start date.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string} dutyClass Duty class to list, from DUTY_CLASS.
 * @param {number=} minDays Length a long episode must exceed; defaults to 4.
 * @returns {Array<!Object>} One row per long episode, longest first.
 */
export function longMcRoster(episodes, dutyClass, minDays = 4) {
  return longEpisodes_(episodes, dutyClass, minDays)
    .map((episode) => ({
      key: episode.key,
      fourD: episode.fourD,
      name: episode.name,
      rank: episode.rank,
      company: episode.company,
      platoon: episode.platoon || UNASSIGNED,
      days: episodeDays_(episode),
      startDate: episode.startDate,
      endDate: episode.endDate,
    }))
    .sort((a, b) => b.days - a.days || a.startDate.localeCompare(b.startDate));
}

/**
 * Soldiers with the most episodes of one duty class.
 *
 * Ranked by number of separate episodes, then by days lost. Deliberately plain
 * arithmetic: it reports what was recorded and infers nothing about why, which is the
 * only claim a parade state can support. A soldier managing a chronic condition and a
 * soldier avoiding training appear the same way here, and the difference is a
 * conversation, not a number.
 * @param {Array<!Object>} episodes Episodes to rank.
 * @param {string|!Array<string>} dutyClass Duty class(es) to rank, from DUTY_CLASS.
 * @returns {Array<!Object>} One entry per soldier, most episodes first.
 */
export function leaderboard(episodes, dutyClass) {
  const bySoldier = new Map();
  episodes
    .filter((episode) => isDuty(dutyClass, episode.dutyClass))
    .forEach((episode) => {
      const entry = bySoldier.get(episode.key) || {
        key: episode.key,
        fourD: episode.fourD,
        name: episode.name,
        rank: episode.rank,
        company: episode.company,
        platoon: episode.platoon || UNASSIGNED,
        episodes: 0,
        daysLost: 0,
        lastStart: null,
      };
      entry.episodes += 1;
      entry.daysLost += episode.daysLost;
      entry.name = episode.name || entry.name;
      entry.company = episode.company || entry.company;
      if (!entry.lastStart || (episode.startDate && episode.startDate > entry.lastStart)) {
        entry.lastStart = episode.startDate;
      }
      bySoldier.set(episode.key, entry);
    });

  return Array.from(bySoldier.values()).sort(
    (a, b) => b.episodes - a.episodes || b.daysLost - a.daysLost
  );
}

/**
 * Groups episodes by a key, counting episodes and distinct soldiers per group.
 *
 * Groups whose key is blank are dropped: an episode naming no company or no platoon has
 * no bar to stand on. It is still counted toward the battalion total by the caller.
 * @param {Array<!Object>} episodes Episodes to group.
 * @param {function(!Object): string} keyOf Reads the grouping key from an episode.
 * @returns {Array<{key: string, episodes: number, soldiers: number}>} One entry per key.
 */
function countGroups_(episodes, keyOf) {
  const groups = new Map();
  episodes.forEach((episode) => {
    const key = keyOf(episode);
    if (key === '') {
      return;
    }
    const group = groups.get(key) || { key, episodes: 0, soldiers: new Set() };
    group.episodes += 1;
    group.soldiers.add(episode.key);
    groups.set(key, group);
  });
  return Array.from(groups.values()).map((group) => ({
    key: group.key,
    episodes: group.episodes,
    soldiers: group.soldiers.size,
  }));
}

/**
 * The volume of one duty class split two ways: how many episodes, how many soldiers.
 *
 * The episode count answers "how many times did this unit go into this state"; the
 * soldier count answers "how many different people was that". The distance between the
 * two is the repeat load — six soldiers filing thirty MCs is a different problem from
 * thirty soldiers filing one each.
 *
 * This is a raw volume, not a size-fair rate: a bigger unit sits higher on both counts
 * for being bigger. The battalion and per-platoon soldier counts are taken from the episode list
 * whole, never summed from `byCompany`: a soldier who files under two companies across
 * the range is one soldier to the battalion but a member of two company groups.
 * @param {Array<!Object>} episodes Episodes to count, any duty class.
 * @param {string|!Array<string>} dutyClass Duty class(es) to keep, from DUTY_CLASS.
 * @returns {{byCompany: Array<{key: string, episodes: number, soldiers: number}>,
 *   byPlatoon: Array<{key: string, episodes: number, soldiers: number}>,
 *   total: {episodes: number, soldiers: number, perSoldier: ?number}}} Company groups
 *   most-episodes first, platoon groups in roll order, and the battalion total with
 *   episodes per soldier (null when no soldier was counted).
 */
export function episodeCounts(episodes, dutyClass) {
  const scoped = episodes.filter((episode) => isDuty(dutyClass, episode.dutyClass));

  const byCompany = countGroups_(scoped, (episode) => toText(episode.company)).sort(
    (a, b) => b.episodes - a.episodes || a.key.localeCompare(b.key)
  );

  const byPlatoonKey = new Map(
    countGroups_(scoped, (episode) => toText(episode.platoon)).map((group) => [group.key, group])
  );
  const byPlatoon = PLATOONS.map((key) => byPlatoonKey.get(key)).filter(Boolean);

  const soldiers = new Set(scoped.map((episode) => episode.key)).size;
  return {
    byCompany,
    byPlatoon,
    total: {
      episodes: scoped.length,
      soldiers,
      perSoldier: soldiers > 0 ? scoped.length / soldiers : null,
    },
  };
}


