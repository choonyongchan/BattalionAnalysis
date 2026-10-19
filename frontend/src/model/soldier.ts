/**
 * One soldier's whole record: the search index (parade-state and FormSG people merged on the identity
 * key, so a search finds someone whichever source named them) and the report once one is picked.
 */

import Fuse from 'fuse.js';
import { classify, DUTY_CLASS, type DutyClass } from './classify.ts';
import type { PersonnelRow } from '../../../shared/dashboard.ts';
import { identityOf } from '../../../shared/identity.ts';
import { platoonOf } from './platoon.ts';
import { bucketsFor } from './statusBuckets.ts';
import { toText } from '../../../shared/values.ts';
import type { DaysSource, Episode } from './episodes.ts';
import type { Submission } from './formsg.ts';

/** One searchable soldier. */
export interface SoldierEntry {
  key: string;
  fourD: string;
  name: string;
  rank: string;
  company: string;
  platoon: string;
  platoonInferred: boolean;
}

/** The fields a source row can tell us about a soldier. */
const FIELDS = ['fourD', 'name', 'rank', 'company', 'platoon'] as const;

type Mention = Partial<Record<(typeof FIELDS)[number], string | null>>;
type Known = Record<(typeof FIELDS)[number], string> & { key: string };

/** Folds a later mention into an entry: each non-blank field wins. */
function fold(entry: Known, mention: Mention): void {
  for (const field of FIELDS) {
    const text = toText(mention[field]);
    if (text !== '') entry[field] = text;
  }
}

/** Oldest first. */
const byDate = <T extends { date: string }>(rows: T[]): T[] => rows.slice().sort((a, b) => a.date.localeCompare(b.date));

/** One index entry per distinct soldier across both sources, folded oldest first so later details win. */
export function soldierIndex(personnel: PersonnelRow[], submissions: Submission[]): SoldierEntry[] {
  const bySoldier = new Map<string, Known>();
  const remember = (key: string, mention: Mention) => {
    if (key === '') return;
    const entry = bySoldier.get(key) ?? { key, fourD: '', name: '', rank: '', company: '', platoon: '' };
    fold(entry, mention);
    bySoldier.set(key, entry);
  };
  byDate(personnel).forEach((row) => remember(identityOf(row).key, row));
  byDate(submissions).forEach((submission) => remember(submission.key, submission));
  return Array.from(bySoldier.values()).map((entry) => {
    const { platoon, inferred } = platoonOf(entry);
    return { ...entry, platoon, platoonInferred: inferred };
  });
}

/** Distinct reasons and how often each appears, most common first. */
function reasonTable(reasons: string[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) {
    const text = toText(reason);
    if (text !== '') counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return Array.from(counts, ([reason, count]) => ({ reason, count })).sort(
    (a, b) => b.count - a.count || a.reason.localeCompare(b.reason),
  );
}

/** One soldier's whole record for the Soldier page. */
export interface SoldierReport {
  key: string;
  identitySource: 'fourD' | 'name' | 'none' | 'formsg';
  counts: { reportSick: number; ma: number; mc: number; offLeave: number; statuses: number };
  absences: { dutyClass: DutyClass; startDate: string | null; endDate: string | null; days: number; daysSource: DaysSource; reason: string }[];
  others: { date: string; reason: string; location: string }[];
  reasonTables: Record<'mc' | 'reportSick' | 'status', { reason: string; count: number }[]>;
  formSg: { date: string; type: string; reason: string }[];
}

/** One soldier's report, or null when the key matches nothing. */
export function soldierReport(
  key: string,
  data: { personnel: PersonnelRow[]; episodes: Episode[]; submissions: Submission[] },
): SoldierReport | null {
  const ownRows = data.personnel.filter((row) => identityOf(row).key === key);
  const ownEpisodes = data.episodes.filter((episode) => episode.key === key);
  const ownSubmissions = data.submissions.filter((submission) => submission.key === key);
  if (ownRows.length === 0 && ownEpisodes.length === 0 && ownSubmissions.length === 0) return null;

  const ofClass = (dutyClass: DutyClass) => ownEpisodes.filter((episode) => episode.dutyClass === dutyClass);
  return {
    key,
    identitySource: ownRows[0] ? identityOf(ownRows[0]).source : 'formsg',
    counts: {
      reportSick: ofClass(DUTY_CLASS.REPORT_SICK).length,
      ma: ofClass(DUTY_CLASS.MA).length,
      mc: ofClass(DUTY_CLASS.ATT_C).length,
      offLeave: ofClass(DUTY_CLASS.OFF_LEAVE).length,
      statuses: ofClass(DUTY_CLASS.STATUS).length,
    },
    // Newest first: "how has this soldier been lately".
    absences: [...ofClass(DUTY_CLASS.ATT_C), ...ofClass(DUTY_CLASS.OFF_LEAVE)]
      .sort((a, b) => toText(b.startDate).localeCompare(toText(a.startDate)))
      .map((episode) => ({
        dutyClass: episode.dutyClass,
        startDate: episode.startDate,
        endDate: episode.endDate,
        days: episode.daysLost,
        daysSource: episode.daysLostSource,
        reason: episode.reasons.join('; '),
      })),
    // Oldest first: duties and attachments read as a narrative.
    others: ownRows
      .filter((row) => classify(row) === DUTY_CLASS.OTHERS)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({ date: row.date, reason: toText(row.reason), location: toText(row.location) })),
    reasonTables: {
      mc: reasonTable(ofClass(DUTY_CLASS.ATT_C).flatMap((episode) => episode.reasons)),
      reportSick: reasonTable(ofClass(DUTY_CLASS.REPORT_SICK).flatMap((episode) => episode.reasons)),
      status: reasonTable(ofClass(DUTY_CLASS.STATUS).flatMap((episode) => episode.reasons.flatMap(bucketsFor))),
    },
    formSg: ownSubmissions
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((submission) => ({ date: submission.date, type: submission.reportSickType, reason: submission.reason })),
  };
}

/** Fuzzy search by 4D or name; a 4D outweighs a loose name hit. [] for a blank query. */
export function findSoldier(index: SoldierEntry[], query: string): SoldierEntry[] {
  const text = toText(query);
  if (text === '') return [];
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
