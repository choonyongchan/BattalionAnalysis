/**
 * What soldiers say is wrong with them. FormSG's pick-list (eight clinical categories, 97% of
 * submissions) drives the charts; the free text is shown beside it. "Others" stays 'Other' (a finding)
 * and a blank answer is 'Unstated', never a ninth condition.
 */

import { keywords } from './classify.ts';
import { addDays } from '../../../shared/dates.ts';
import { toText } from '../../../shared/values.ts';
import type { Episode } from './episodes.ts';
import type { Submission } from './formsg.ts';
import type { Cell } from './metrics.ts';

/** The eight clinical categories, verbatim as FormSG stores them, most frequent first. */
export const CLINICAL_BUCKETS = [
  'Upper Respiratory Tract Infection (Fever/Flu etc.)',
  'Fever / Headache (High Temp, Severe Migraine etc.)',
  'Musculoskeletal (Pain/Sprain/Strain/Numbness of Arm, Leg, Ankle etc)',
  'Gastrointestinal (Diarrhoea, Vomiting, Nausea)',
  'Dermatology Related (Skin Rashes/Abrasion/Eczema/Burns and Cuts)',
  'Chest Pain & Shortness of Breath',
  'Eye & Sight Related (Conjunctivitis/Soreness in Eye etc.)',
  'Psychiatric / Mental Wellness (Stress/Anxiety/Insomnia etc.)',
];

/** The pick-list category of an answer: exact match only, so "Others: Cough" stays Other, not URTI. */
export function clinicalBucketOf(answer: unknown): string {
  const value = toText(answer);
  if (value === '') return 'Unstated';
  return CLINICAL_BUCKETS.includes(value) ? value : 'Other';
}

/** Word-cloud frequencies from the free-text reason alone (the pick-list wording would drown it), most first. */
export function reasonKeywords(submissions: Pick<Submission, 'reason'>[], limit = 40): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const submission of submissions) {
    for (const word of keywords(submission.reason)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return Array.from(counts, ([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit);
}

/**
 * Words in a reason that point to something catching.
 * ponytail: a word list over free text; a reason that says only "MC" is not counted.
 */
const INFECTIOUS = /fever|flu|cough|cold|sore throat|urti|runny|diarrh|vomit|gastr|food poison|nausea|conjunctivitis|pink eye/i;

/** Cases in one platoon within `CLUSTER_DAYS` that make a cluster. */
export const CLUSTER_CASES = 3;

/** The window, in days, a cluster's cases fall within. */
export const CLUSTER_DAYS = 3;

/** A platoon-day cell naming its new infectious-sounding cases. */
export interface CaseCell extends Cell {
  names: string[];
}

/** New infectious-sounding cases per `Company Platoon` per day over the window, and the rows holding a cluster. */
export function infectiousByPlatoon(
  episodes: Episode[],
  to: string,
  days: number,
  platoonOf: (episode: Episode) => string,
): { days: string[]; rows: string[]; cells: CaseCell[]; clusters: string[] } {
  const window = Array.from({ length: days }, (_, offset) => addDays(to, offset - days + 1));
  const byCell = new Map<string, Set<string>>();
  for (const episode of episodes) {
    if (!episode.startDate || !window.includes(episode.startDate) || !INFECTIOUS.test(episode.reasons.join(' '))) continue;
    const key = `${episode.company} ${platoonOf(episode)}|${episode.startDate}`;
    byCell.set(key, (byCell.get(key) ?? new Set()).add(`${episode.rank} ${episode.name}`.trim()));
  }
  const casesOn = (row: string, day: string) => byCell.get(row + '|' + day) ?? new Set<string>();
  const rows = Array.from(new Set(Array.from(byCell.keys(), (key) => key.split('|')[0]!))).sort();
  const cells = rows.flatMap((row) =>
    window.map((day) => ({ row, column: day, value: casesOn(row, day).size, names: Array.from(casesOn(row, day)).sort() })),
  );
  const clusters = rows.filter((row) => {
    const counts = window.map((day) => casesOn(row, day).size);
    return counts.some((_, i) => counts.slice(i, i + CLUSTER_DAYS).reduce((a, b) => a + b, 0) >= CLUSTER_CASES);
  });
  return { days: window, rows, cells, clusters };
}

/** Day bands for MC length, shortest first. */
export const LENGTH_BANDS = [
  { label: '1 day', max: 1 },
  { label: '2–3 days', max: 3 },
  { label: '4–7 days', max: 7 },
  { label: '8+ days', max: Infinity },
];

/** Episodes per symptom per length band (an episode naming two symptoms counts under each), top `limit` symptoms. */
export function lengthBySymptom(episodes: Episode[], limit: number): { rows: string[]; cells: Cell[] } {
  const counts = new Map<string, Map<string, number>>();
  for (const episode of episodes) {
    const band = LENGTH_BANDS.find((entry) => episode.daysLost <= entry.max)!.label;
    for (const symptom of episode.symptoms.length > 0 ? episode.symptoms : ['Not stated']) {
      const row = counts.get(symptom) ?? new Map<string, number>();
      row.set(band, (row.get(band) ?? 0) + 1);
      counts.set(symptom, row);
    }
  }
  const total = (symptom: string) => Array.from(counts.get(symptom)!.values()).reduce((a, b) => a + b, 0);
  const rows = Array.from(counts.keys())
    .sort((a, b) => total(b) - total(a) || a.localeCompare(b))
    .slice(0, limit);
  const cells = rows.flatMap((row) => LENGTH_BANDS.map(({ label }) => ({ row, column: label, value: counts.get(row)!.get(label) ?? 0 })));
  return { rows, cells };
}
