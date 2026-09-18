/**
 * The top reasons for a duty class, tracked across Daily/Weekly/Monthly/Rotational time
 * buckets — the data behind the grouped-bar-with-a-granularity-radio chart that the
 * Report Sick, MC/MA and Status pages each show.
 *
 * One function serves all three, because the shape of the question is identical: which
 * labels dominate, and how does that mix move over time. What differs between the pages
 * is only which label a row contributes — a FormSG clinical bucket, an extracted symptom,
 * a Status bucket — and that is decided by the caller's `labelsOf` function, not by this
 * module.
 *
 * Every function here is pure.
 */

import { bucketOf } from './buckets.js';

/** @type {string} The bucket a label falls into once it drops out of the top N. */
export const OTHER_LABEL = 'Other';

/**
 * Tracks the top labels for a set of dated items across time buckets.
 * @param {Array<{date: string, labels: string[]}>} items One entry per row, already
 *     resolved to zero or more labels — a row with no label contributes nothing.
 * @param {string} granularity One of `buckets.js`'s GRANULARITIES names.
 * @param {Array<{name: string, start: string, end: ?string}>} rotations Rotations, for
 *     the rotational grain; pass `[]` when none are configured.
 * @param {number=} topN How many labels to track individually; the rest fold into
 *     OTHER_LABEL. Defaults to 5.
 * @returns {{categories: string[], series: Array<{name: string, values: number[]}>}} One
 *     series per top label plus, when anything was folded, one for "Other" — ready for a
 *     grouped-bar chart.
 */
export function topLabelsOverTime(items, granularity, rotations, topN) {
  const limit = topN || 5;

  const totals = new Map();
  items.forEach((item) => {
    if (!item.date) return;
    item.labels.forEach((label) => totals.set(label, (totals.get(label) || 0) + 1));
  });
  const top = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label]) => label);
  const topSet = new Set(top);
  const hasOther = totals.size > top.length;

  const buckets = new Map();
  const order = [];
  items.forEach((item) => {
    if (!item.date) return;
    const bucket = bucketOf(item.date, granularity, rotations);
    if (!buckets.has(bucket.key)) {
      buckets.set(bucket.key, { label: bucket.label, counts: new Map() });
      order.push(bucket.key);
    }
    const counts = buckets.get(bucket.key).counts;
    item.labels.forEach((label) => {
      const key = topSet.has(label) ? label : OTHER_LABEL;
      if (key === OTHER_LABEL && !hasOther) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });

  const orderedKeys = order.slice().sort();
  const categories = orderedKeys.map((key) => buckets.get(key).label);
  const seriesNames = hasOther ? top.concat(OTHER_LABEL) : top;

  return {
    categories,
    series: seriesNames.map((name) => ({
      name,
      values: orderedKeys.map((key) => buckets.get(key).counts.get(name) || 0),
    })),
  };
}
