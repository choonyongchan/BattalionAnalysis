/**
 * Who, most often, and for how long — the leaderboards and unit rankings.
 *
 * `metrics.leaderboard` already collapses episodes into one row per soldier with an
 * episode count and days lost; this module reads that rather than re-deriving it, and
 * adds the three things it does not do: a platoon that covers Hercules and Cougar (whose
 * `platoon` cell is blank on 100% and 96% of rows) via `platoon.js`'s inference, the
 * temporary/permanent split Status leaderboards need, and count-based unit rankings.
 *
 * Every function here is pure.
 */

import { platoonOf } from './platoon.js';
import { isPermanentStatus } from './statusBuckets.js';
import { classify, isDuty } from './classify.js';
import { identityOf } from './identity.js';
import { leaderboard } from './metrics.js';
import { toIsoDate, toText } from './values.js';

/**
 * Resolves a leaderboard row's platoon through the 4D-inference rule.
 * @param {!Object} entry A row from `metrics.leaderboard`.
 * @returns {{platoon: string, inferred: boolean}} The platoon to display.
 */
function platoonFor_(entry) {
  return platoonOf({ platoon: entry.platoon, four_d: entry.fourD });
}

/**
 * Whether an episode's Status rows read as permanent.
 *
 * `episode.permanent` only checks the `PERM_STATUS_NUM_DAYS` sentinel, which no row in
 * the observed data carries — every permanent Status row signals it in the reason text
 * instead. So this checks the episode's own reasons the same way `isPermanentStatus`
 * checks a row's, rather than trusting a flag that is always false in practice.
 * @param {!Object} episode An episode from `buildEpisodes`.
 * @returns {boolean} True when the episode reads as a permanent status.
 */
function episodeIsPermanent_(episode) {
  if (episode.permanent) {
    return true;
  }
  return isPermanentStatus({ reason: episode.reasons.join(' '), num_days: episode.statedDays });
}

/**
 * The most common count-based leaderboards: report sick, MA, and similar.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string|!Array<string>} dutyClass Duty class(es) to rank, from DUTY_CLASS.
 * @param {number=} limit Rows to return; defaults to 10.
 * @returns {Array<{key: string, fourD: string, name: string, rank: string, company: string,
 *     platoon: string, platoonInferred: boolean, count: number}>} Most episodes first,
 *     ties broken by name.
 */
export function topByCount(episodes, dutyClass, limit) {
  return leaderboard(episodes, dutyClass)
    .sort((a, b) => b.episodes - a.episodes || a.name.localeCompare(b.name))
    .slice(0, limit || 10)
    .map((entry) => {
      const { platoon, inferred } = platoonFor_(entry);
      return {
        key: entry.key,
        fourD: entry.fourD,
        name: entry.name,
        rank: entry.rank,
        company: entry.company,
        platoon,
        platoonInferred: inferred,
        count: entry.episodes,
      };
    });
}

/**
 * The MC leaderboard: soldier, company, platoon, number of MCs, and total days.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string|!Array<string>} dutyClass Duty class(es) to rank, from DUTY_CLASS.
 * @param {number=} limit Rows to return; defaults to 10.
 * @returns {Array<{key: string, fourD: string, name: string, rank: string, company: string,
 *     platoon: string, platoonInferred: boolean, count: number, days: number,
 *     meanDays: number}>} Most days lost first, ties broken by name.
 */
export function topByDays(episodes, dutyClass, limit) {
  return leaderboard(episodes, dutyClass)
    .sort((a, b) => b.daysLost - a.daysLost || a.name.localeCompare(b.name))
    .slice(0, limit || 10)
    .map((entry) => {
      const { platoon, inferred } = platoonFor_(entry);
      return {
        key: entry.key,
        fourD: entry.fourD,
        name: entry.name,
        rank: entry.rank,
        company: entry.company,
        platoon,
        platoonInferred: inferred,
        count: entry.episodes,
        days: entry.daysLost,
        meanDays: entry.episodes > 0 ? entry.daysLost / entry.episodes : 0,
      };
    });
}

/**
 * The Status leaderboard: how many statuses a soldier holds, split temporary/permanent.
 *
 * Requirement 5.2 asks for exactly this split rather than a day count, because a
 * permanent excuse does not have a meaningful duration to sum.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {number=} limit Rows to return; defaults to 10.
 * @returns {Array<{key: string, fourD: string, name: string, rank: string, company: string,
 *     platoon: string, platoonInferred: boolean, temporary: number, permanent: number,
 *     count: number}>} Most statuses held first, ties broken by name.
 */
export function topByStatusCount(episodes, limit) {
  const statusEpisodes = episodes.filter((episode) => episode.dutyClass === 'Status');
  const bySoldier = new Map();

  statusEpisodes.forEach((episode) => {
    const entry = bySoldier.get(episode.key) || {
      key: episode.key,
      fourD: episode.fourD,
      name: episode.name,
      rank: episode.rank,
      company: episode.company,
      platoon: episode.platoon,
      temporary: 0,
      permanent: 0,
    };
    if (episodeIsPermanent_(episode)) {
      entry.permanent += 1;
    } else {
      entry.temporary += 1;
    }
    entry.name = episode.name || entry.name;
    bySoldier.set(episode.key, entry);
  });

  return Array.from(bySoldier.values())
    .map((entry) => ({ ...entry, count: entry.temporary + entry.permanent }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit || 10)
    .map((entry) => {
      const { platoon, inferred } = platoonFor_(entry);
      return { ...entry, platoon, platoonInferred: inferred };
    });
}

/**
 * Companies or platoons ranked by absence count, highest first.
 *
 * A thin pass-through to `metrics.companyRates` / `unitRates`, which already rank on
 * `per100` rather than the raw count — kept here so a page reads one ranking function
 * regardless of level instead of branching between two metrics-layer names.
 * @param {Array<!Object>} personnelRows Normalised Personnel Data records.
 * @param {Array<!Object>} strengthRows Unused; retained for the shared caller shape.
 * @param {string|!Array<string>} dutyClass Duty class(es) to rank, from DUTY_CLASS.
 * @param {string} level 'company' or 'platoon'.
 * @returns {Array<!Object>} Units ranked by count, highest first.
 */
export function rankUnits(personnelRows, _strengthRows, dutyClass, level) {
  const counts = new Map();
  personnelRows
    .filter((row) => isDuty(dutyClass, classify(row)))
    .forEach((row) => {
      const identity = identityOf(row);
      const unit = toText(row.company);
      const platoon = platoonOf(row).platoon;
      if (identity.key === '' || unit === '') return;
      const key = level === 'platoon' ? unit + '\u0000' + platoon : unit;
      const soldiers = counts.get(key) || new Set();
      soldiers.add(identity.key + '@' + (toIsoDate(row.date) || ''));
      counts.set(key, soldiers);
    });

  return Array.from(counts, ([key, soldiers]) => {
    const [company, platoon] = key.split('\u0000');
    return { company, platoon, days: soldiers.size, count: soldiers.size };
  }).sort(
    (a, b) => b.count - a.count || a.company.localeCompare(b.company) || (a.platoon || '').localeCompare(b.platoon || '')
  );
}
