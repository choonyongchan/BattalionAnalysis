/**
 * The top reasons over time buckets, for the grouped-bar charts on the Report Sick, MC/MA and Status
 * pages; the caller decides which labels each item carries.
 */

import { bucketOf } from './buckets.ts';
import type { Rotation } from '../../../shared/rotations.ts';

/** The series labels fold into once they drop out of the top N. */
export const OTHER_LABEL = 'Other';

/** One dated item and the labels it contributes (none contributes nothing). */
export interface LabelledItem {
  date: string | null;
  labels: string[];
}

/** Bucket labels and one series per top label (plus "Other" when anything folded). */
export interface GroupedSeries {
  categories: string[];
  series: { name: string; values: number[] }[];
}

/** Tracks the `topN` most frequent labels across time buckets; the rest fold into "Other". */
export function topLabelsOverTime(items: LabelledItem[], granularity: string, rotations: Rotation[], topN = 5): GroupedSeries {
  const dated = items.filter((item): item is LabelledItem & { date: string } => Boolean(item.date));
  const totals = new Map<string, number>();
  for (const item of dated) for (const label of item.labels) totals.set(label, (totals.get(label) ?? 0) + 1);
  const top = Array.from(totals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([label]) => label);
  const topSet = new Set(top);
  const hasOther = totals.size > top.length;

  const buckets = new Map<string, { label: string; counts: Map<string, number> }>();
  for (const item of dated) {
    const bucket = bucketOf(item.date, granularity, rotations);
    const entry = buckets.get(bucket.key) ?? { label: bucket.label, counts: new Map<string, number>() };
    buckets.set(bucket.key, entry);
    for (const label of item.labels) {
      const name = topSet.has(label) ? label : OTHER_LABEL;
      entry.counts.set(name, (entry.counts.get(name) ?? 0) + 1);
    }
  }

  const keys = Array.from(buckets.keys()).sort();
  const names = hasOther ? [...top, OTHER_LABEL] : top;
  return {
    categories: keys.map((key) => buckets.get(key)!.label),
    series: names.map((name) => ({ name, values: keys.map((key) => buckets.get(key)!.counts.get(name) ?? 0) })),
  };
}
