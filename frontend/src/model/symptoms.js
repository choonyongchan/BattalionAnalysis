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
import { addDays } from '../../../shared/dates.js';
import { toText } from '../../../shared/values.js';

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
const OTHER_BUCKET = 'Other';

/** @type {string} The bucket for a submission that answered the question with nothing. */
const UNSTATED_BUCKET = 'Unstated';




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

/**
 * Words in a parade-state reason that point to something catching: fever, flu, a cough or
 * cold, a stomach bug, conjunctivitis.
 * ponytail: a word list over free text; a reason that says only "MC" is not counted.
 * @type {!RegExp}
 */
const INFECTIOUS = /fever|flu|cough|cold|sore throat|urti|runny|diarrh|vomit|gastr|food poison|nausea|conjunctivitis|pink eye/i;

/** @type {number} Cases in one platoon within `CLUSTER_DAYS` that make a cluster. */
export const CLUSTER_CASES = 3;

/** @type {number} The window, in days, a cluster's cases fall within. */
export const CLUSTER_DAYS = 3;

/**
 * New infectious-sounding cases per platoon per day, and the platoons where they cluster.
 *
 * A case is an episode (report sick, MC or MA) starting on the day whose reason names an
 * infectious symptom. The platoon is the sub-header (`platoon.js`); a platoon with no case
 * in the window is left off.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string} to The last day of the window, inclusive.
 * @param {number} days How many days the window holds.
 * @param {function(!Object): string} platoonOf Resolves an episode's platoon.
 * @returns {{days: string[], rows: string[], cells: Array<{row: string, column: string,
 *     value: number, names: string[]}>, clusters: string[]}} Window days, `Company Platoon`
 *     rows, one cell per row and day, and the rows holding a cluster.
 */
export function infectiousByPlatoon(episodes, to, days, platoonOf) {
  const window = Array.from({ length: days }, (_, offset) => addDays(to, offset - days + 1));
  const byCell = new Map();
  episodes
    .filter((episode) => window.includes(episode.startDate) && INFECTIOUS.test(episode.reasons.join(' ')))
    .forEach((episode) => {
      const row = episode.company + ' ' + platoonOf(episode);
      const key = row + '|' + episode.startDate;
      const names = byCell.get(key) || new Set();
      names.add((episode.rank + ' ' + episode.name).trim());
      byCell.set(key, names);
    });
  const rows = Array.from(new Set(Array.from(byCell.keys(), (key) => key.split('|')[0]))).sort();
  const cells = rows.flatMap((row) =>
    window.map((day) => {
      const names = byCell.get(row + '|' + day) || new Set();
      return { row, column: day, value: names.size, names: Array.from(names).sort() };
    })
  );
  const clusters = rows.filter((row) => {
    const counts = window.map((day) => (byCell.get(row + '|' + day) || new Set()).size);
    return counts.some((_, i) => counts.slice(i, i + CLUSTER_DAYS).reduce((a, b) => a + b, 0) >= CLUSTER_CASES);
  });
  return { days: window, rows, cells, clusters };
}
