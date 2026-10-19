/**
 * FormSG report-sick submissions, the primary source for what people report sick with: the form asks
 * every soldier for a reason and symptoms, while most parade-state MC lines say only "MC".
 */

import { extractSymptoms, keywords } from './classify.ts';
import { identityKey, normaliseFourD } from '../../../shared/identity.ts';
import { toIsoDate, toText, toTimeOfDay } from '../../../shared/values.ts';
import { weekdayOf } from '../../../shared/dates.ts';
import { COMPANIES, type ReportSickType } from '../../../shared/domain.ts';
import type { ReportSickRow, StrengthRow } from '../../../shared/dashboard.ts';
import { battalionStrength, type Cell, type Part } from './metrics.ts';
import { settingOf } from './activeSettings.ts';

/** The report-sick types a filter lists, in order, with what a reader sees. */
export const REPORT_SICK_TYPES: { name: ReportSickType; label: string }[] = [
  { name: 'RSO', label: 'RSO' },
  { name: 'RSI', label: 'RSI' },
  { name: 'FFI', label: 'FFI' },
  { name: 'MR', label: 'Medical Review' },
];

/** One normalised submission. */
export interface Submission {
  date: string;
  timestamp: string;
  rank: string;
  name: string;
  fourD: string;
  /** The identity key personnel rows are joined on. */
  key: string;
  /** '' when the form's "Unit & Coy" answer named no known company. */
  company: string;
  unitText: string;
  reportSickType: string;
  /** `MC`, `Status`, `Both`, `None`, or '' when not yet recorded. */
  outcome: string;
  statuses: string[];
  /** Free-text reason. */
  reason: string;
  /** The pick-list symptom answer the clinical breakdown counts. */
  symptomAnswer: string;
  /** Reason and symptom answer joined, which the lexicon reads best. */
  text: string;
  symptoms: string[];
  keywords: string[];
}

/** The report-sick type code of a submission, or '' when none was recorded. */
export function reportSickTypeOf(submission: Pick<Submission, 'reportSickType'>): ReportSickType | '' {
  const text = toText(submission.reportSickType).toUpperCase();
  return REPORT_SICK_TYPES.find((type) => type.name === text)?.name ?? '';
}

/** Submissions, distinct submitters, and submissions per submitter (null when nobody reported sick). */
export function submissionCounts(submissions: Submission[]): { total: { submissions: number; soldiers: number; perSoldier: number | null } } {
  const soldiers = new Set(submissions.map((submission) => submission.key).filter((key) => key !== '')).size;
  return { total: { submissions: submissions.length, soldiers, perSoldier: soldiers > 0 ? submissions.length / soldiers : null } };
}

/** Normalises FormSG rows, oldest first; rows with no readable date are dropped. */
export function toSubmissions(rows: ReportSickRow[]): Submission[] {
  return rows
    .map((row) => {
      const reason = toText(row.reason);
      const symptomAnswer = toText(row.symptoms);
      const text = [reason, symptomAnswer].filter((part) => part !== '').join('. ');
      const name = toText(row.name);
      const fourD = normaliseFourD(row.fourD);
      return {
        date: toIsoDate(row.timestamp),
        timestamp: row.timestamp,
        rank: toText(row.rank),
        name,
        fourD,
        key: identityKey(fourD, name),
        company: row.company ?? '',
        unitText: toText(row.unitCoy),
        reportSickType: toText(row.reportSickType),
        outcome: toText(row.outcome),
        statuses: row.statuses,
        reason,
        symptomAnswer,
        text,
        symptoms: extractSymptoms(text),
        keywords: keywords(text),
      };
    })
    .filter((submission): submission is Submission => submission.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** A dated series per line of a chart. */
export interface Trend {
  dates: string[];
  series: { name: string; values: number[] }[];
}

/**
 * Submissions per day: one battalion line (per 100 accountable unless `asRate` is false), or a raw
 * count per company, where a company with none is a flat zero line (the honest picture of no adoption).
 */
export function submissionTrend(
  submissions: Submission[],
  strengthRows: StrengthRow[],
  dates: string[],
  { scope = 'battalion', session = 'FPS', asRate = true }: { scope?: string; session?: string; asRate?: boolean } = {},
): Trend {
  const byDate = new Map<string, Map<string, number>>();
  for (const submission of submissions) {
    const bucket = byDate.get(submission.date) ?? new Map<string, number>();
    bucket.set(submission.company, (bucket.get(submission.company) ?? 0) + 1);
    byDate.set(submission.date, bucket);
  }
  const countOn = (date: string, company: string) => byDate.get(date)?.get(company) ?? 0;

  if (scope === 'companies') {
    return { dates, series: COMPANIES.map((company) => ({ name: company, values: dates.map((date) => countOn(date, company)) })) };
  }
  const values = dates.map((date) => {
    const total = Array.from(byDate.get(date)?.values() ?? []).reduce((sum, count) => sum + count, 0);
    if (!asRate) return total;
    const { accountable } = battalionStrength(strengthRows, date, session);
    return accountable > 0 ? (total / accountable) * 100 : 0;
  });
  return { dates, series: [{ name: 'Battalion', values }] };
}

/** One soldier's submission count. FormSG names no platoon, so none is shown. */
export interface Submitter {
  key: string;
  fourD: string;
  name: string;
  rank: string;
  company: string;
  count: number;
}

/** The soldiers submitting the most forms (each form is one event), ties by name. */
export function topSubmitters(submissions: Submission[], limit = settingOf('thresholds').leaderboardSize): Submitter[] {
  const bySoldier = new Map<string, Submitter>();
  for (const submission of submissions) {
    if (submission.key === '') continue;
    const entry = bySoldier.get(submission.key) ?? {
      key: submission.key,
      fourD: submission.fourD,
      name: submission.name,
      rank: submission.rank,
      company: submission.company,
      count: 0,
    };
    entry.count += 1;
    entry.name = submission.name || entry.name;
    entry.company = submission.company || entry.company;
    bySoldier.set(submission.key, entry);
  }
  return Array.from(bySoldier.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Submissions per report-sick type, in filter order, then "Not stated". */
export function typeShares(submissions: Submission[]): Part[] {
  const counts = new Map<string, number>();
  for (const submission of submissions) {
    const type = reportSickTypeOf(submission);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [
    ...REPORT_SICK_TYPES.map((type) => ({ name: type.label, value: counts.get(type.name) ?? 0 })),
    { name: 'Not stated', value: counts.get('') ?? 0 },
  ];
}

/** Submissions by weekday (`row`) and two-digit hour (`column`), for a punch-card grid; non-empty cells only. */
export function hourByWeekday(submissions: Submission[]): Cell[] {
  const counts = new Map<string, number>();
  for (const submission of submissions) {
    const at = toTimeOfDay(submission.timestamp);
    if (!at) continue;
    const key = weekdayOf(submission.date).name + '|' + String(at.hour).padStart(2, '0');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, value]) => {
    const [row = '', column = ''] = key.split('|');
    return { row, column, value };
  });
}
