/**
 * Self-Regulated Fitness Training: who trained, where, doing what, in how big a group.
 * A soldier is counted by normalised name (the form asks no 4D); a group is everyone naming the same
 * Group IC on one day, with free-typed IC names consolidated by fuzzy matching.
 */

import Fuse from 'fuse.js';
import { COMPANIES, isCompany } from '../../../shared/domain.ts';
import type { PersonnelRow, SftSessionRow } from '../../../shared/dashboard.ts';
import { nameTokens, namesMatch, normaliseName } from '../../../shared/identity.ts';
import { toIsoDate, toText } from '../../../shared/values.ts';
import { bucketsFor } from './statusBuckets.ts';

/** How the form joins a checkbox answer's selections. */
const EXERCISE_SEPARATOR = /\s*;\s*/;

/**
 * The Fuse score (0 exact, 1 anything) under which two name *tokens* are one word. Per token, so
 * "TAN WEI MING" / "TAN WEI LIANG" stay apart while a one-letter slip (MINH/MING, 0.25) merges.
 */
const TOKEN_THRESHOLD = 0.25;

/** One SFT session, normalised. */
export interface SftSession {
  date: string;
  timestamp: string;
  rank: string;
  name: string;
  /** Normalised name; '' when the session names nobody. */
  key: string;
  company: string;
  groupIc: string;
  pesStatus: string;
  exercises: string[];
  sfabtType: string;
  location: string;
}

/** A label and how often it occurred. */
export interface LabelCount {
  label: string;
  count: number;
}

/** Normalises SFT rows into sessions; undated rows are dropped. */
export function toSftSessions(rows: SftSessionRow[]): SftSession[] {
  return rows
    .map((row) => ({
      date: toIsoDate(row.date),
      timestamp: toText(row.timestamp),
      rank: toText(row.rank),
      name: toText(row.name),
      key: normaliseName(row.name),
      company: isCompany(row.company) ? row.company : '',
      groupIc: toText(row.groupIc),
      pesStatus: toText(row.pesStatus),
      exercises: toText(row.exercises).split(EXERCISE_SEPARATOR).filter(Boolean),
      sfabtType: toText(row.sfabtType),
      location: toText(row.location),
    }))
    .filter((session): session is SftSession => session.date !== null);
}

/** Distinct soldiers among some sessions; a nameless session counts once on its own. */
export function soldierCount(sessions: SftSession[]): number {
  return new Set(sessions.map((session, index) => session.key || '#' + index)).size;
}

/** Sessions and soldiers per company, every company listed in parade order. */
export function byCompany(sessions: SftSession[]): { company: string; sessions: number; soldiers: number }[] {
  return COMPANIES.map((company) => {
    const mine = sessions.filter((session) => session.company === company);
    return { company, sessions: mine.length, soldiers: soldierCount(mine) };
  });
}

/** Counts labels, merging case and spacing variants under the first spelling seen; most common first. */
function topLabels(labels: string[], limit: number): LabelCount[] {
  const counts = new Map<string, LabelCount>();
  for (const raw of labels) {
    const label = toText(raw).replace(/\s+/g, ' ');
    if (!label) continue;
    const entry = counts.get(label.toUpperCase()) ?? { label, count: 0 };
    entry.count += 1;
    counts.set(label.toUpperCase(), entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, limit);
}

/** The most common training locations. */
export function topLocations(sessions: SftSession[], limit: number): LabelCount[] {
  return topLabels(sessions.map((session) => session.location), limit);
}

/**
 * Free-text exercise names folded into one label each; first match wins.
 * ponytail: hard-coded; move to Settings if clerks need to edit it.
 */
const EXERCISE_GROUPS = [
  { pattern: /\b(run|running|jog|jogging|walk|walking|er|endurance)\b/i, label: 'Run' },
  { pattern: /\b(gym|weights?|strength|power|chest|shoulders?|legs?|arms?)\b/i, label: 'Gym / Weights' },
];

/** The most common exercises (spellings folded); a session doing three counts once for each. */
export function topExercises(sessions: SftSession[], limit: number): LabelCount[] {
  const labelOf = (exercise: string) => EXERCISE_GROUPS.find((entry) => entry.pattern.test(exercise))?.label ?? exercise;
  return topLabels(
    sessions.flatMap((session) => Array.from(new Set(session.exercises.map(labelOf)))),
    limit,
  );
}

/** Fuse's score for finding `needle` in `haystack`: 0 exact, 1 when not found. */
function fuseScore(needle: string, haystack: string): number {
  const [hit] = new Fuse([haystack], { includeScore: true, threshold: 1, ignoreLocation: true }).search(needle);
  return hit?.score ?? 1;
}

/** Whether two tokens are one word, typos allowed; scored both ways because Fuse finds "TAN" inside "TANG". */
function tokensMatch(a: string, b: string): boolean {
  return a === b || Math.max(fuseScore(a, b), fuseScore(b, a)) <= TOKEN_THRESHOLD;
}

/** Whether two typed names plausibly name the same person, tolerating typos. */
export function fuzzyNamesMatch(a: string, b: string): boolean {
  return namesMatch(a, b) || namesMatch(a, b, tokensMatch);
}

/** One person's sessions as Group IC on one day; `label` is the first spelling seen. */
export interface IcCluster {
  date: string;
  label: string;
  tokens: string;
  members: SftSession[];
}

/** Each day's IC names consolidated into one cluster per person; sessions with a blank IC join none. */
export function groupIcClusters(sessions: SftSession[]): IcCluster[] {
  const byDay = new Map<string, IcCluster[]>();
  for (const session of sessions) {
    const tokens = nameTokens(session.groupIc).join(' ');
    if (!tokens) continue;
    const clusters = byDay.get(session.date) ?? [];
    byDay.set(session.date, clusters);
    let cluster = clusters.find((candidate) => fuzzyNamesMatch(candidate.label, session.groupIc));
    if (!cluster) {
      cluster = { date: session.date, label: session.groupIc, tokens, members: [] };
      clusters.push(cluster);
    }
    cluster.members.push(session);
  }
  return [...byDay.values()].flat();
}

/** One training group's size. */
export interface GroupSize {
  date: string;
  ic: string;
  company: string;
  size: number;
}

/** Every group: its distinct members, plus the IC when the IC did not file too; company is the members' majority. */
export function groupSizes(sessions: SftSession[]): GroupSize[] {
  return groupIcClusters(sessions).map((cluster) => {
    const icFiled = cluster.members.some((member) => fuzzyNamesMatch(member.name, cluster.label));
    return {
      date: cluster.date,
      ic: cluster.label,
      company: topLabels(cluster.members.map((member) => member.company), 1)[0]?.label ?? '',
      size: soldierCount(cluster.members) + (icFiled ? 0 : 1),
    };
  });
}

/** The mean group size, or null when there are none. */
export function averageGroupSize(groups: { size: number }[]): number | null {
  return groups.length === 0 ? null : groups.reduce((sum, group) => sum + group.size, 0) / groups.length;
}

/** Groups of each size from 1 to the largest, empty sizes included so the axis has no gaps. */
export function groupSizeDistribution(groups: { size: number }[]): { size: number; count: number }[] {
  const largest = groups.reduce((max, group) => Math.max(max, group.size), 0);
  return Array.from({ length: largest }, (_, index) => ({
    size: index + 1,
    count: groups.filter((group) => group.size === index + 1).length,
  }));
}

/** The restrictions that limit physical training. */
const TRAINING_RESTRICTIONS = ['Light Duty', 'Excuse RMJ', 'Excuse Heavy Load', 'Excuse Upper Limb', 'Excuse Kneeling/Squatting'];

/** A session logged while the soldier held a training restriction. */
export interface RestrictedSession {
  date: string;
  rank: string;
  name: string;
  company: string;
  exercises: string;
  restrictions: string;
}

/**
 * Sessions logged on a day the soldier held a training restriction (a Status line on that parade,
 * or stated dates covering it), newest first. Each line is for a person to judge.
 */
export function sftAgainstStatus(sessions: SftSession[], personnelRows: PersonnelRow[]): RestrictedSession[] {
  const status = personnelRows.filter((row) => row.reasonCategory === 'Status');
  const heldOn = (row: PersonnelRow, date: string) => {
    const start = toIsoDate(row.startDate);
    const end = toIsoDate(row.endDate);
    return row.date === date || (start !== null && end !== null && start <= date && date <= end);
  };
  return sessions
    .map((session) => {
      const restrictions = new Set(
        status.filter((row) => heldOn(row, session.date) && namesMatch(session.name, row.name)).flatMap((row) => bucketsFor(row.reason)),
      );
      return {
        date: session.date,
        rank: session.rank,
        name: session.name,
        company: session.company,
        exercises: session.exercises.join(', '),
        restrictions: TRAINING_RESTRICTIONS.filter((bucket) => restrictions.has(bucket)).join(', '),
      };
    })
    .filter((line) => line.restrictions !== '')
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}
