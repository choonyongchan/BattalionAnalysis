/**
 * Normalises FormSG report-sick submissions into the shape the views consume.
 *
 * This tab matters more than its row count suggests. In the parade state only 16 of 61
 * `Att C` rows carry any symptom detail — the rest are a bare "MC" — whereas FormSG asks
 * every soldier for a reason and a symptom list. It is therefore the *primary* source for
 * what people are actually reporting sick with, and the parade state is the secondary one.
 *
 * Company comes from a free-text "Unit & Coy" answer, so it is matched against the known
 * company names rather than trusted. An answer naming no known company is kept with a
 * blank company instead of being guessed at or dropped.
 *
 * Every function here is pure.
 */

import { extractSymptoms, keywords } from './classify.js';
import { identityKey, normaliseFourD } from '../../../shared/identity.js';
import { toIsoDate, toText, toTimeOfDay } from '../../../shared/values.js';
import { weekdayOf } from '../../../shared/dates.js';
import { COMPANIES } from '../../../shared/domain.js';
import { battalionStrength } from './metrics.js';
import { settingOf } from './activeSettings.js';

/**
 * Finds the company named in a free-text unit answer.
 * @param {string} text The "Unit & Coy" answer.
 * @returns {string} A known company name, or ''.
 */
function companyFrom_(text) {
  const value = toText(text).toUpperCase();
  return COMPANIES.filter((company) => value.includes(company.toUpperCase()))[0] || '';
}

/**
 * The report-sick types a FormSG submission can carry, in the order a filter lists them.
 * `name` is the short code the database stores; `label` is what a reader sees.
 * @type {Array<{name: string, label: string}>}
 */
export const REPORT_SICK_TYPES = [
  { name: 'RSO', label: 'RSO' },
  { name: 'RSI', label: 'RSI' },
  { name: 'FFI', label: 'FFI' },
  { name: 'MR', label: 'Medical Review' },
];

/**
 * The form's verbatim type answers, as a Sheet-era row carries them, mapped to short codes.
 * @type {!Object<string, string>}
 */
const VERBATIM_TYPES_ = {
  'REPORT SICK IN-CAMP (RSI)': 'RSI',
  'REPORT SICK OUTSIDE (RSO)': 'RSO',
  'MEDICAL REVIEW': 'MR',
};

/**
 * The short code of a submission's report-sick type.
 *
 * The read route stores the short code (`RSO`), but a row imported from the Sheet may
 * still carry the form's full answer (`Report Sick Outside (RSO)`), so both are read.
 * @param {!Object} submission A normalised submission from `toSubmissions`.
 * @returns {string} A `REPORT_SICK_TYPES` name, or '' when no known type was recorded.
 */
export function reportSickTypeOf(submission) {
  const text = toText(submission.reportSickType).toUpperCase();
  if (REPORT_SICK_TYPES.some((type) => type.name === text)) return text;
  return VERBATIM_TYPES_[text] || '';
}

/**
 * Headline counts for the FormSG "reported sick" side, mirroring `metrics.episodeCounts`.
 *
 * A submission is already one event, so `submissions` is a plain row count. `soldiers` is
 * the distinct submitter count (by `submission.key`, the 4D- or name-derived identity),
 * and `perSoldier` their ratio — `null`, not a division error, when nobody reported sick.
 * @param {Array<!Object>} submissions Normalised submissions, already restricted to the
 *     range being summarised.
 * @returns {{total: {submissions: number, soldiers: number, perSoldier: ?number}}} The
 *     counts, nested under `total` to match `episodeCounts`' shape.
 */
export function submissionCounts(submissions) {
  const soldiers = new Set(
    submissions.map((submission) => submission.key).filter((key) => key !== '')
  ).size;
  return {
    total: {
      submissions: submissions.length,
      soldiers,
      perSoldier: soldiers > 0 ? submissions.length / soldiers : null,
    },
  };
}

/**
 * Maps FormSG records to a common submission shape.
 *
 * The form asks two different questions about the same illness and they must not be
 * merged. `symptomAnswer` is a pick-list — eight clean clinical options covering 97% of
 * submissions — and it is what the clinical breakdown counts. `reason` is free text, and
 * it is what the word cloud reads. Folding them into one string, as this function once
 * did, costs both: the pick-list can then only be recovered by searching the blob for its
 * own label, and the cloud fills up with the pick-list's boilerplate wording.
 *
 * `text` keeps the joined form, because the symptom lexicon works better across both
 * fields than across either alone — a soldier who picks "Others" often names the symptom
 * in the reason.
 *
 * `outcome` is the doctor's outcome as stored (`MC`, `Status`, `Both`, `None`, or '' when
 * not yet recorded), and `statuses` the non-blank "Status Given #n" answers.
 * @param {Array<!Object>} rows Records from the FormSG tab.
 * @returns {Array<!Object>} Normalised submissions, oldest first.
 */
export function toSubmissions(rows) {
  return rows
    .map((row) => {
      const reason = toText(row['Reason for Reporting Sick (Keep Brief)']);
      const symptomAnswer = toText(row['I am experiencing _____________________ symptoms.']);
      const text = [reason, symptomAnswer].filter((part) => part !== '').join('. ');
      const name = toText(row['[Myinfo] Name']);
      const fourD = normaliseFourD(row['4D Number (REC Only)']);
      return {
        date: toIsoDate(row.Timestamp),
        timestamp: row.Timestamp,
        rank: toText(row.RANK),
        name,
        fourD,
        // Built by `identityKey`, never inline: this is the key a submission is joined to
        // its personnel rows on, so a third spelling of the same rule is a third chance
        // for the two sources to describe one soldier as two.
        key: identityKey(fourD, name),
        company: companyFrom_(row['Unit & Coy']),
        unitText: toText(row['Unit & Coy']),
        reportSickType: toText(row['Report Sick Type']),
        outcome: toText(row['Outcome given by the doctor/MO']),
        statuses: [1, 2, 3, 4, 5]
          .map((n) => toText(row['Status Given #' + n]))
          .filter((status) => status !== ''),
        reason,
        symptomAnswer,
        text,
        symptoms: extractSymptoms(text),
        keywords: keywords(text),
      };
    })
    .filter((submission) => submission.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The "reported sick" trend (FormSG submissions), battalion-wide or by company.
 *
 * A count, not a rate, in the companies scope: zero FormSG submissions in a day is a real
 * fact about that company, unlike a parade-state gap — nobody has to file a form for the
 * absence of one to be informative. A company with no submissions is drawn as a flat
 * line at zero rather than a gap, which is the honest picture of a channel with no
 * adoption.
 * @param {Array<!Object>} submissions Normalised FormSG submissions from `toSubmissions`.
 * @param {Array<!Object>} strengthRows Normalised Strength Data records, for the
 *     battalion-scope rate; unused when `asRate` is false.
 * @param {string[]} dates Dates to plot, oldest first.
 * @param {{scope?: string, session?: string, asRate?: boolean}=} options `scope` is
 *     'battalion' (a rate per 100 accountable) or 'companies' (a raw count per company);
 *     `asRate` divides the battalion series by strength, defaulting true, and false makes
 *     it a raw submission count; `session` defaults to 'FPS' and is used only to look up
 *     battalion strength for the rate.
 * @returns {{dates: string[], series: Array<{name: string, values: number[]}>}} The trend.
 */
export function submissionTrend(submissions, strengthRows, dates, options) {
  const scope = (options && options.scope) || 'battalion';
  const session = (options && options.session) || 'FPS';
  const asRate = !options || options.asRate !== false;

  const byDate = new Map();
  submissions.forEach((submission) => {
    const bucket = byDate.get(submission.date) || new Map();
    bucket.set(submission.company, (bucket.get(submission.company) || 0) + 1);
    byDate.set(submission.date, bucket);
  });

  if (scope === 'companies') {
    return {
      dates,
      series: COMPANIES.map((company) => ({
        name: company,
        values: dates.map((date) => (byDate.get(date) || new Map()).get(company) || 0),
      })),
    };
  }

  return {
    dates,
    series: [
      {
        name: 'Battalion',
        values: dates.map((date) => {
          const total = Array.from((byDate.get(date) || new Map()).values()).reduce(
            (sum, count) => sum + count,
            0
          );
          if (!asRate) {
            return total;
          }
          const strength = battalionStrength(strengthRows, date, session);
          return strength.accountable > 0 ? (total / strength.accountable) * 100 : 0;
        }),
      },
    ],
  };
}

/**
 * The soldiers submitting the most FormSG report-sick forms.
 *
 * The parade-state "reporting sick" leaderboard (`leaderboards.topByCount` over
 * `DUTY_CLASS.REPORT_SICK` episodes) and this one answer different questions, because
 * they are different sources of the same real-world event: a soldier can submit the form
 * without a matching parade-state row yet, or the reverse. This module has no episode
 * concept — a FormSG submission is already one event, not a daily snapshot to collapse.
 * @param {Array<!Object>} submissions Normalised submissions from `toSubmissions`.
 * @param {number=} limit Rows to return; defaults to the Thresholds leaderboard size (10).
 * @returns {Array<{key: string, fourD: string, name: string, rank: string, company: string,
 *     count: number}>} Most submissions first, ties broken by name. No platoon: FormSG's
 *     "Unit & Coy" answer carries no platoon, so one cannot be shown here — see
 *     `docs/architecture_patterns.md` on deriving nothing the message does not state.
 */
export function topSubmitters(submissions, limit) {
  const bySoldier = new Map();
  submissions.forEach((submission) => {
    if (submission.key === '') return;
    const entry = bySoldier.get(submission.key) || {
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
  });
  return Array.from(bySoldier.values())
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit || settingOf('thresholds').leaderboardSize);
}


/**
 * How the submissions split across the form's report-sick types: the parts of one whole.
 * @param {Array<!Object>} submissions Normalised submissions, already restricted to the range.
 * @returns {Array<{name: string, value: number}>} One part per type in the form's order, then
 *     "Not stated" for an answer that maps to no type.
 */
export function typeShares(submissions) {
  const counts = new Map();
  submissions.forEach((submission) => {
    const type = reportSickTypeOf(submission);
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return [
    ...REPORT_SICK_TYPES.map((type) => ({ name: type.label, value: counts.get(type.name) || 0 })),
    { name: 'Not stated', value: counts.get('') || 0 },
  ];
}

/**
 * When soldiers file: submissions counted by weekday and hour, for a punch-card grid.
 *
 * A weekday-by-hour grid rather than two histograms, so weekday and weekend sit on the same
 * scale per day instead of a five-day total against a two-day one.
 * @param {Array<!Object>} submissions Normalised submissions, already restricted to the range.
 * @returns {Array<{row: string, column: string, value: number}>} Non-empty cells; `row` a
 *     weekday name, `column` the two-digit hour.
 */
export function hourByWeekday(submissions) {
  const counts = new Map();
  submissions.forEach((submission) => {
    const at = toTimeOfDay(submission.timestamp);
    if (!at || !submission.date) return;
    const key = weekdayOf(submission.date).name + '|' + String(at.hour).padStart(2, '0');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return Array.from(counts, ([key, value]) => {
    const [row, column] = key.split('|');
    return { row, column, value };
  });
}
