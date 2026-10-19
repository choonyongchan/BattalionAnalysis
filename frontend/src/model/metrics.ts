/**
 * The numbers the dashboard puts on screen. Counts are of soldiers (deduplicated per date), not rows;
 * comparisons are counts, never per-100 rates; a company that has not filed is named, never absorbed.
 */

import { classify, DUTY_CLASS, isAbsent, isDuty, isRestricted, type DutyClass } from './classify.ts';
import { identityOf } from '../../../shared/identity.ts';
import { COMPANIES, UNASSIGNED, UNIT_TYPE_COMPANY } from '../../../shared/domain.ts';
import type { PersonnelRow, StrengthRow } from '../../../shared/dashboard.ts';
import { inclusiveDaySpan } from '../../../shared/dates.ts';
import { toIsoDate, toNumber, toText } from '../../../shared/values.ts';
import { eachDay, withinRange } from './dateRange.ts';
import type { Episode } from './episodes.ts';

/** One duty class, or several counted together. */
export type DutyFilter = DutyClass | DutyClass[];

/** A name and a value: one slice of a ring or bar. */
export interface Part {
  name: string;
  value: number;
}

/** One cell of a row x column grid, as heatmaps draw it. */
export interface Cell {
  row: string;
  column: string;
  value: number;
}

/** The sum of the non-null values. */
function sum(values: (number | null)[]): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

/** Whether a row is on the given parade (null session = either). */
function onParade(row: { date: string; session: string }, isoDate: string, session: string | null | undefined): boolean {
  return row.date === isoDate && (!session || row.session === session);
}

/** The distinct dates in a set of rows, oldest first. */
export function datesPresent(rows: { date: unknown }[]): string[] {
  const dates = new Set(rows.map((row) => toIsoDate(row.date)).filter((date) => date !== null));
  return Array.from(dates).sort();
}

/** One company's strength on a parade. */
export interface CompanyStrength {
  company: string;
  strength: number | null;
  present: number | null;
}

/** Battalion strength on one parade and which companies filed. */
export interface BattalionStrength {
  date: string;
  session: string;
  accountable: number;
  present: number;
  absent: number;
  percentPresent: number | null;
  byCompany: CompanyStrength[];
  companiesReporting: string[];
  companiesMissing: string[];
  isComplete: boolean;
}

/** Battalion strength from company roll-up rows only (summing platoon rows would double-count). */
export function battalionStrength(strengthRows: StrengthRow[], isoDate: string, session: string): BattalionStrength {
  const byCompany = new Map<string, CompanyStrength>();
  for (const row of strengthRows) {
    if (!onParade(row, isoDate, session) || row.unitType !== UNIT_TYPE_COMPANY) continue;
    byCompany.set(row.company, { company: row.company, strength: toNumber(row.totalStrength), present: toNumber(row.totalPresent) });
  }
  const reporting = Array.from(byCompany.keys());
  const reported = Array.from(byCompany.values()).sort((a, b) => a.company.localeCompare(b.company));
  const accountable = sum(reported.map((entry) => entry.strength));
  const present = sum(reported.map((entry) => entry.present));
  return {
    date: isoDate,
    session,
    accountable,
    present,
    absent: accountable - present,
    percentPresent: accountable > 0 ? (present / accountable) * 100 : null,
    byCompany: reported,
    companiesReporting: reporting,
    companiesMissing: COMPANIES.filter((company) => !reporting.includes(company)),
    isComplete: reporting.length === COMPANIES.length,
  };
}

/** Distinct soldiers per duty class on one parade, with absent and restricted totals. */
export interface DutyCounts {
  date: string;
  session: string | null;
  counts: Record<DutyClass, number>;
  absentTotal: number;
  restrictedTotal: number;
  /** Rows naming nobody, counted apart rather than dropped. */
  unattributable: number;
}

/** Distinct soldiers per duty class on one date; a soldier in both sessions counts once. */
export function dutyCountsOn(personnelRows: PersonnelRow[], isoDate: string, session?: string | null): DutyCounts {
  const seen = new Map<DutyClass, Set<string>>();
  let unattributable = 0;
  for (const row of personnelRows) {
    if (!onParade(row, isoDate, session)) continue;
    const { key } = identityOf(row);
    if (key === '') {
      unattributable += 1;
      continue;
    }
    const dutyClass = classify(row);
    seen.set(dutyClass, (seen.get(dutyClass) ?? new Set()).add(key));
  }

  const counts = {} as Record<DutyClass, number>;
  let absentTotal = 0;
  let restrictedTotal = 0;
  for (const dutyClass of Object.values(DUTY_CLASS)) {
    const size = seen.get(dutyClass)?.size ?? 0;
    counts[dutyClass] = size;
    if (isAbsent(dutyClass)) absentTotal += size;
    if (isRestricted(dutyClass)) restrictedTotal += size;
  }
  return { date: isoDate, session: session || null, counts, absentTotal, restrictedTotal, unattributable };
}

/** Distinct soldiers in one or more duty classes on one date (someone on MC and MA counts once). */
export function distinctDutyOn(personnelRows: PersonnelRow[], isoDate: string, session: string | null, dutyClass: DutyFilter): number {
  const keys = new Set<string>();
  for (const row of personnelRows) {
    if (!onParade(row, isoDate, session) || !isDuty(dutyClass, classify(row))) continue;
    const { key } = identityOf(row);
    if (key !== '') keys.add(key);
  }
  return keys.size;
}

/** An episode's length for the long-MC test: the stated count, else its start-to-end span. */
function episodeDays(episode: Episode): number {
  if (episode.statedDays !== null && episode.statedDays > 0) return episode.statedDays;
  return inclusiveDaySpan(episode.startDate!, episode.endDate!);
}

/** Episodes of a duty class lasting more than `minDays`. */
function longEpisodes(episodes: Episode[], dutyClass: DutyFilter, minDays: number): Episode[] {
  return episodes.filter(
    (episode) => isDuty(dutyClass, episode.dutyClass) && episode.startDate && episode.endDate && episodeDays(episode) > minDays,
  );
}

/** Distinct soldiers on a long episode on each calendar day of the range, oldest first. */
export function longMcTrend(
  episodes: Episode[],
  fromIso: string | null,
  toIso: string | null,
  dutyClass: DutyFilter,
  minDays = 4,
): { date: string; count: number }[] {
  const long = longEpisodes(episodes, dutyClass, minDays);
  return eachDay(fromIso, toIso).map((day) => {
    const soldiers = new Set(long.filter((episode) => withinRange(day, episode.startDate, episode.endDate)).map((episode) => episode.key));
    return { date: day, count: soldiers.size };
  });
}

/** One long episode, as the roster lists it. */
export interface LongMcRow {
  key: string;
  fourD: string;
  name: string;
  rank: string;
  company: string;
  platoon: string;
  days: number;
  startDate: string;
  endDate: string;
}

/** One row per long episode (a soldier may appear twice), longest first, ties to the earlier start. */
export function longMcRoster(episodes: Episode[], dutyClass: DutyFilter, minDays = 4): LongMcRow[] {
  return longEpisodes(episodes, dutyClass, minDays)
    .map((episode) => ({
      key: episode.key,
      fourD: episode.fourD,
      name: episode.name,
      rank: episode.rank,
      company: episode.company,
      platoon: episode.platoon || UNASSIGNED,
      days: episodeDays(episode),
      startDate: episode.startDate!,
      endDate: episode.endDate!,
    }))
    .sort((a, b) => b.days - a.days || a.startDate.localeCompare(b.startDate));
}

/** One soldier's tally on a leaderboard. */
export interface LeaderboardEntry {
  key: string;
  fourD: string;
  name: string;
  rank: string;
  company: string;
  platoon: string;
  episodes: number;
  daysLost: number;
  lastStart: string | null;
}

/** Soldiers by number of episodes, then days lost: what was recorded, inferring nothing about why. */
export function leaderboard(episodes: Episode[], dutyClass: DutyFilter): LeaderboardEntry[] {
  const bySoldier = new Map<string, LeaderboardEntry>();
  for (const episode of episodes) {
    if (!isDuty(dutyClass, episode.dutyClass)) continue;
    const entry = bySoldier.get(episode.key) ?? {
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
    if (!entry.lastStart || (episode.startDate && episode.startDate > entry.lastStart)) entry.lastStart = episode.startDate;
    bySoldier.set(episode.key, entry);
  }
  return Array.from(bySoldier.values()).sort((a, b) => b.episodes - a.episodes || b.daysLost - a.daysLost);
}

/** Episodes and distinct soldiers in one group. */
export interface GroupCount {
  key: string;
  episodes: number;
  soldiers: number;
}

/** Episode volume two ways, per company and for the battalion; the gap between them is the repeat load. */
export interface EpisodeCounts {
  byCompany: GroupCount[];
  total: { episodes: number; soldiers: number; perSoldier: number | null };
}

/** Episodes and distinct soldiers per company (most episodes first) and in total (counted whole, not summed). */
export function episodeCounts(episodes: Episode[], dutyClass: DutyFilter): EpisodeCounts {
  const scoped = episodes.filter((episode) => isDuty(dutyClass, episode.dutyClass));
  const groups = new Map<string, { episodes: number; soldiers: Set<string> }>();
  for (const episode of scoped) {
    if (episode.company === '') continue;
    const group = groups.get(episode.company) ?? { episodes: 0, soldiers: new Set<string>() };
    group.episodes += 1;
    group.soldiers.add(episode.key);
    groups.set(episode.company, group);
  }
  const byCompany = Array.from(groups, ([key, group]) => ({ key, episodes: group.episodes, soldiers: group.soldiers.size })).sort(
    (a, b) => b.episodes - a.episodes || a.key.localeCompare(b.key),
  );
  const soldiers = new Set(scoped.map((episode) => episode.key)).size;
  return { byCompany, total: { episodes: scoped.length, soldiers, perSoldier: soldiers > 0 ? scoped.length / soldiers : null } };
}

/** The soldiers out of camp on one parade, by why, in a fixed order so the ring does not reshuffle. */
export function absenceParts(duty: DutyCounts): Part[] {
  const parts: [string, DutyClass][] = [
    ['MC', DUTY_CLASS.ATT_C],
    ['MA', DUTY_CLASS.MA],
    ['Off / leave', DUTY_CLASS.OFF_LEAVE],
    ['Other duties', DUTY_CLASS.OTHERS],
  ];
  return parts.map(([name, dutyClass]) => ({ name, value: duty.counts[dutyClass] || 0 }));
}

/** What "Other duties" holds on one parade: soldiers per duty as named before any bracket, most first. */
export function otherDutiesOn(personnelRows: PersonnelRow[], isoDate: string, session: string | null): Part[] {
  const byDuty = new Map<string, Set<string>>();
  for (const row of personnelRows) {
    if (!onParade(row, isoDate, session) || classify(row) !== DUTY_CLASS.OTHERS) continue;
    const { key } = identityOf(row);
    if (key === '') continue;
    const name = toText(row.reason).split('(')[0]!.trim().toUpperCase() || 'NOT STATED';
    byDuty.set(name, (byDuty.get(name) ?? new Set()).add(key));
  }
  return Array.from(byDuty, ([name, soldiers]) => ({ name, value: soldiers.size })).sort(
    (a, b) => b.value - a.value || a.name.localeCompare(b.name),
  );
}
