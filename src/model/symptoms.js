/**
 * What soldiers say is wrong with them, from FormSG's two questions about it.
 *
 * The form asks a pick-list question and a free-text one, and they answer different
 * things. The pick-list is eight clinical categories covering 97% of 2,344 submissions —
 * it is clean, comparable, and it is what a trend chart should be drawn from. The free
 * text is how a soldier described it in their own words, which is worth reading precisely
 * because it is not one of eight options. Both are shown, side by side, rather than one
 * standing in for the other.
 *
 * Two answers the pick-list gives that are not conditions, and are kept apart on purpose:
 * an `Others: <text>` answer is 'Other' — the soldier saw the eight options and chose none
 * of them, which is a finding — and a blank answer is 'Unstated', because a question not
 * answered is not a ninth condition.
 *
 * Every function here is pure.
 */

import { keywords } from './classify.js';
import { toText } from './values.js';

/**
 * The eight clinical categories, verbatim as FormSG stores them, most frequent first.
 * @type {string[]}
 */
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

/** @type {string} The bucket for a soldier who picked "Others". */
export const OTHER_BUCKET = 'Other';

/** @type {string} The bucket for a submission that answered the question with nothing. */
export const UNSTATED_BUCKET = 'Unstated';

/**
 * Chart-axis labels, because the verbatim options run to seventy characters.
 * @type {!Object<string, string>}
 */
const SHORT_LABELS = {
  [CLINICAL_BUCKETS[0]]: 'URTI',
  [CLINICAL_BUCKETS[1]]: 'Fever / headache',
  [CLINICAL_BUCKETS[2]]: 'Musculoskeletal',
  [CLINICAL_BUCKETS[3]]: 'Gastrointestinal',
  [CLINICAL_BUCKETS[4]]: 'Dermatology',
  [CLINICAL_BUCKETS[5]]: 'Chest pain',
  [CLINICAL_BUCKETS[6]]: 'Eye & sight',
  [CLINICAL_BUCKETS[7]]: 'Mental wellness',
  [OTHER_BUCKET]: OTHER_BUCKET,
  [UNSTATED_BUCKET]: UNSTATED_BUCKET,
};

/**
 * Every bucket a submission can land in, in chart order.
 * @type {string[]}
 */
export const ALL_BUCKETS = CLINICAL_BUCKETS.concat([OTHER_BUCKET, UNSTATED_BUCKET]);

/**
 * The short label for a bucket, for use on an axis or in a legend.
 * @param {string} bucket A bucket name.
 * @returns {string} The short label, or the bucket itself if it has none.
 */
export function shortLabel(bucket) {
  return SHORT_LABELS[bucket] || bucket;
}

/**
 * The bucket a pick-list answer belongs to.
 *
 * Matched on the exact stored option, then on the `Others:` prefix. Deliberately not a
 * substring search: "Others: Cough" names a symptom that URTI also covers, and a loose
 * match would file it under URTI — hiding the fact that the soldier was offered URTI and
 * did not choose it.
 * @param {*} answer The pick-list answer.
 * @returns {string} One of CLINICAL_BUCKETS, OTHER_BUCKET, or UNSTATED_BUCKET.
 */
export function clinicalBucketOf(answer) {
  const value = toText(answer);
  if (value === '') {
    return UNSTATED_BUCKET;
  }
  return CLINICAL_BUCKETS.includes(value) ? value : OTHER_BUCKET;
}

/**
 * Counts submissions per clinical bucket.
 * @param {Array<!Object>} submissions Normalised submissions from `toSubmissions`.
 * @returns {Array<{bucket: string, label: string, count: number}>} Buckets, largest first.
 */
export function clinicalCounts(submissions) {
  const counts = new Map();
  (submissions || []).forEach((submission) => {
    const bucket = clinicalBucketOf(submission.symptomAnswer);
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([bucket, count]) => ({ bucket, label: shortLabel(bucket), count }))
    .sort(
      (a, b) => b.count - a.count || ALL_BUCKETS.indexOf(a.bucket) - ALL_BUCKETS.indexOf(b.bucket)
    );
}

/**
 * Word frequencies across the free-text reason field, for the word cloud.
 *
 * Reads `reason` alone, not the joined `text`: the pick-list's own wording would otherwise
 * dominate the cloud with the boilerplate of eight fixed options and drown out the phrasing
 * the cloud exists to surface.
 * @param {Array<!Object>} submissions Normalised submissions.
 * @param {number=} limit Most words to return; defaults to 40.
 * @returns {Array<{word: string, count: number}>} Words, most frequent first.
 */
export function reasonKeywords(submissions, limit) {
  const counts = new Map();
  (submissions || []).forEach((submission) => {
    keywords(toText(submission.reason)).forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))
    .slice(0, limit || 40);
}
