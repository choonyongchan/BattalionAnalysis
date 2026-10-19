/**
 * Who, most often, and for how long: soldier leaderboards and unit rankings, read from
 * `metrics.leaderboard` with each soldier's platoon resolved through `platoon.ts`.
 */

import { platoonOf } from './platoon.ts';
import { isPermanentStatus } from './statusBuckets.ts';
import { DUTY_CLASS, isDuty } from './classify.ts';
import { leaderboard, type DutyFilter, type LeaderboardEntry } from './metrics.ts';
import type { Episode } from './episodes.ts';
import { settingOf } from './activeSettings.ts';

/** The fields every leaderboard row shows about the soldier. */
export interface RankedSoldier {
  key: string;
  fourD: string;
  name: string;
  rank: string;
  company: string;
  platoon: string;
  platoonInferred: boolean;
  count: number;
}

/** The Thresholds leaderboard size. */
const defaultLimit = (): number => settingOf('thresholds').leaderboardSize;

/** A leaderboard row's identity, with its platoon resolved. */
function ranked(entry: Pick<LeaderboardEntry, 'key' | 'fourD' | 'name' | 'rank' | 'company' | 'platoon'>, count: number): RankedSoldier {
  const { platoon, inferred } = platoonOf(entry);
  const { key, fourD, name, rank, company } = entry;
  return { key, fourD, name, rank, company, platoon, platoonInferred: inferred, count };
}

/** Whether a Status episode reads as permanent, by the sentinel or (what fires today) its reasons. */
function episodeIsPermanent(episode: Episode): boolean {
  return episode.permanent || isPermanentStatus({ reason: episode.reasons.join(' '), numDays: episode.statedDays });
}

/** Soldiers with the most episodes of a duty class, ties by name. */
export function topByCount(episodes: Episode[], dutyClass: DutyFilter, limit = defaultLimit()): RankedSoldier[] {
  return leaderboard(episodes, dutyClass)
    .sort((a, b) => b.episodes - a.episodes || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => ranked(entry, entry.episodes));
}

/** Soldiers losing the most days to a duty class, with episodes and mean length, ties by name. */
export function topByDays(
  episodes: Episode[],
  dutyClass: DutyFilter,
  limit = defaultLimit(),
): (RankedSoldier & { days: number; meanDays: number })[] {
  return leaderboard(episodes, dutyClass)
    .sort((a, b) => b.daysLost - a.daysLost || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => ({
      ...ranked(entry, entry.episodes),
      days: entry.daysLost,
      meanDays: entry.episodes > 0 ? entry.daysLost / entry.episodes : 0,
    }));
}

/** Soldiers holding the most statuses, split temporary/permanent (a permanent excuse has no duration to sum). */
export function topByStatusCount(
  episodes: Episode[],
  limit = defaultLimit(),
): (RankedSoldier & { temporary: number; permanent: number })[] {
  const bySoldier = new Map<string, Episode & { temporary: number; permanentCount: number }>();
  for (const episode of episodes) {
    if (episode.dutyClass !== DUTY_CLASS.STATUS) continue;
    const entry = bySoldier.get(episode.key) ?? { ...episode, temporary: 0, permanentCount: 0 };
    if (episodeIsPermanent(episode)) entry.permanentCount += 1;
    else entry.temporary += 1;
    entry.name = episode.name || entry.name;
    bySoldier.set(episode.key, entry);
  }
  return Array.from(bySoldier.values())
    .map((entry) => ({
      ...ranked(entry, entry.temporary + entry.permanentCount),
      temporary: entry.temporary,
      permanent: entry.permanentCount,
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** One company (or company platoon) by episode count and distinct soldiers. */
export interface UnitRank {
  company: string;
  platoon: string | undefined;
  count: number;
  soldiers: number;
}

/** Companies or platoons ranked by episodes, then soldiers. */
export function rankUnits(episodes: Episode[], dutyClass: DutyFilter, level: 'company' | 'platoon'): UnitRank[] {
  const units = new Map<string, { count: number; soldiers: Set<string> }>();
  for (const episode of episodes) {
    if (!isDuty(dutyClass, episode.dutyClass) || episode.key === '' || episode.company === '') continue;
    const platoon = platoonOf(episode).platoon;
    const key = level === 'platoon' ? episode.company + '\u0000' + platoon : episode.company;
    const entry = units.get(key) ?? { count: 0, soldiers: new Set<string>() };
    entry.count += 1;
    entry.soldiers.add(episode.key);
    units.set(key, entry);
  }
  return Array.from(units, ([key, entry]) => {
    const [company = '', platoon] = key.split('\u0000');
    return { company, platoon, count: entry.count, soldiers: entry.soldiers.size };
  }).sort(
    (a, b) =>
      b.count - a.count ||
      b.soldiers - a.soldiers ||
      a.company.localeCompare(b.company) ||
      (a.platoon ?? '').localeCompare(b.platoon ?? ''),
  );
}

/** Every soldier's episodes and days lost, and how many of all days lost the `top` soldiers hold. */
export function soldierLoad(
  episodes: Episode[],
  dutyClass: DutyFilter,
  top: number,
): { entries: LeaderboardEntry[]; totalDays: number; topDays: number } {
  const entries = leaderboard(episodes, dutyClass).sort((a, b) => b.daysLost - a.daysLost);
  const daysOf = (rows: LeaderboardEntry[]) => rows.reduce((total, entry) => total + entry.daysLost, 0);
  return { entries, totalDays: daysOf(entries), topDays: daysOf(entries.slice(0, top)) };
}
