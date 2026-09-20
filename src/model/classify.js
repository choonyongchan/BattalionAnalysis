/**
 * Duty classification and symptom extraction.
 *
 * Two jobs, both of which the dashboard's headline numbers rest on.
 *
 * **Classification is a category match, never a text match.** `Att C` *is* MC: Attend C
 * means excused all duties, and in national service that normally means resting at home
 * on a medical certificate. Every `Att C` row is therefore MC, including the ones whose
 * `reason` reads `HL`, `FEVER` or `FOOD POISONING` rather than the letters "MC".
 * Matching on the text instead would be wrong in both directions — it would miss those
 * three, and it would sweep in the `AFMC` rows (Air Force Medical Centre appointments,
 * filed under `Others`) and `RETURNING FROM MC`, which are not absences on MC at all.
 * `dashboard/test/classify.test.js` pins both directions.
 *
 * **Status is not absence.** `Status` is Attend B / light duty — excused specific
 * activities while still reporting for duty. Folding it into an absentee count would
 * overstate what the battalion cannot field, which is the most consequential mistake
 * this dashboard could make, so `EMPLOYABILITY` keeps the two apart.
 *
 * Every function here is pure.
 */

import { toText } from './values.js';

/**
 * The duty classes the dashboard reports, keyed by `reason_category`.
 * @type {!Object<string, string>}
 */
export const DUTY_CLASS = {
  ATT_C: 'Att C',
  REPORT_SICK: 'Report Sick',
  STATUS: 'Status',
  MA: 'MA',
  OFF_LEAVE: 'Off/Leave',
  OTHERS: 'Others',
  UNKNOWN: 'Unknown',
};

/**
 * Maps a Personnel Data `reason_category` to a duty class.
 *
 * Mirrors `REASON_CATEGORIES` in `src/parser/ParserSchema.js`. A category outside this
 * map is surfaced as UNKNOWN rather than dropped, so an upstream enum change shows up
 * as a visible bucket instead of quietly shrinking every total.
 * @type {!Object<string, string>}
 */
const CATEGORY_TO_CLASS = {
  'Att C': DUTY_CLASS.ATT_C,
  'Report Sick': DUTY_CLASS.REPORT_SICK,
  Status: DUTY_CLASS.STATUS,
  MA: DUTY_CLASS.MA,
  'Off/Leave': DUTY_CLASS.OFF_LEAVE,
  Others: DUTY_CLASS.OTHERS,
};

/**
 * How each duty class bears on whether the soldier can be employed today.
 *
 * ABSENT and RESTRICTED are deliberately distinct: the doctrinal split between
 * accountable strength (who you have) and operating strength (who you can employ).
 * REPORT_SICK is an EVENT — a soldier who reported sick this morning may return to
 * duty, go on MC, or be given a status, and the parade state records the visit rather
 * than the outcome, so counting it as absence would double-count against the MC row
 * that often follows.
 * @type {!Object<string, string>}
 */
const EMPLOYABILITY = {
  [DUTY_CLASS.ATT_C]: 'ABSENT',
  [DUTY_CLASS.REPORT_SICK]: 'EVENT',
  [DUTY_CLASS.STATUS]: 'RESTRICTED',
  [DUTY_CLASS.MA]: 'ABSENT',
  [DUTY_CLASS.OFF_LEAVE]: 'ABSENT',
  [DUTY_CLASS.OTHERS]: 'ABSENT',
  [DUTY_CLASS.UNKNOWN]: 'UNKNOWN',
};

/**
 * Classifies a personnel row by its reason category.
 * @param {!Object} row A normalised Personnel Data record.
 * @returns {string} One of DUTY_CLASS's values.
 */
export function classify(row) {
  const category = toText(row && row.reason_category);
  return CATEGORY_TO_CLASS[category] || DUTY_CLASS.UNKNOWN;
}

/**
 * Whether a duty class means the soldier could not be employed that day.
 * @param {string} dutyClass One of DUTY_CLASS's values.
 * @returns {boolean} True when the class counts as absence.
 */
export function isAbsent(dutyClass) {
  return EMPLOYABILITY[dutyClass] === 'ABSENT';
}

/**
 * Whether a duty class means present but restricted (Attend B / light duty).
 * @param {string} dutyClass One of DUTY_CLASS's values.
 * @returns {boolean} True when the class counts as present-with-limitations.
 */
export function isRestricted(dutyClass) {
  return EMPLOYABILITY[dutyClass] === 'RESTRICTED';
}

/**
 * The symptom lexicon: a canonical label and the patterns that map onto it.
 *
 * Order matters. More specific entries come first, because `matchSymptoms` stops a
 * pattern's competitors from also claiming the same words — "sore throat" must not also
 * register as generic "pain", and "food poisoning" must not merely register as
 * "gastric".
 * @type {Array<{label: string, pattern: !RegExp}>}
 */
const SYMPTOM_LEXICON = [
  { label: 'Food poisoning', pattern: /food\s*poison/i },
  { label: 'Sore throat', pattern: /sore\s*throat|throat\s*(pain|ache|infection)|hurts?\s*to\s*swallow|painful\s*swallow/i },
  { label: 'Runny nose', pattern: /runny\s*nose|running\s*nose|rhinorrh?ea/i },
  { label: 'Blocked nose', pattern: /block(ed)?\s*nose|nose\s*block|congest/i },
  { label: 'Nose bleed', pattern: /nose\s*bleed|bleeding\s*nose|epistaxis/i },
  { label: 'Shortness of breath', pattern: /short(ness)?\s*of\s*breath|breathless|difficulty\s*breathing/i },
  { label: 'Chest pain', pattern: /chest\s*(pain|tight|discomfort)/i },
  { label: 'Fever', pattern: /fever|febrile|high\s*temp/i },
  { label: 'Cough', pattern: /cough/i },
  { label: 'Flu', pattern: /\bflu\b|influenza|\bcold\b/i },
  { label: 'Phlegm', pattern: /phlegm|sputum/i },
  { label: 'Headache', pattern: /head\s*ache|headache|migraine/i },
  { label: 'Giddiness', pattern: /giddi|dizz|light\s*headed|vertigo/i },
  { label: 'Nausea / vomiting', pattern: /nausea|nauseous|vomit|puking/i },
  { label: 'Diarrhoea', pattern: /diarrh?o?ea|loose\s*stool|\bLS\b/i },
  { label: 'Gastric', pattern: /gastric|stomach|abdominal|tummy/i },
  { label: 'Rash / skin', pattern: /rash|hives|eczema|acne|itch|abbrasion|abrasion|blister/i },
  { label: 'Eye', pattern: /\beyes?\b|vision|conjunctiv/i },
  { label: 'Dental', pattern: /tooth|teeth|dental|wisdom/i },
  { label: 'Knee', pattern: /\bknee/i },
  { label: 'Ankle / foot', pattern: /ankle|\bfoot\b|\bfeet\b|heel|toe/i },
  { label: 'Back', pattern: /\bback\s*(pain|ache)|backache|spine|lumbar/i },
  { label: 'Shoulder / arm', pattern: /shoulder|elbow|wrist|\barm\b|upper\s*limb/i },
  { label: 'Hip / thigh / leg', pattern: /\bhip\b|thigh|calf|shin|\bleg\b|lower\s*limb/i },
  { label: 'Sprain / strain', pattern: /sprain|strain|tendon|ligament|fracture/i },
  { label: 'Fatigue', pattern: /fatigue|exhaust|lethargic|weak(ness)?/i },
  { label: 'Pain (unspecified)', pattern: /\bpain(ful)?\b|\bache\b|\binjur/i },
];

/**
 * Markers stripped before symptom matching, so bookkeeping is not read as a symptom.
 * @type {!RegExp}
 */
const NON_SYMPTOM_MARKERS = /\b(MC|HL|RSI|RSO|AFMC|Att\s*[ABC])\b/gi;

/**
 * Extracts canonical symptoms from a free-text reason.
 *
 * Runs over the whole string rather than only a parenthetical, because the two sources
 * word it differently: the parade state writes `MC (Fever, cough)` while FormSG's
 * answer is bare prose. Each lexicon entry can match at most once, so "cough, coughing,
 * bad cough" counts as one soldier with a cough rather than three.
 * @param {string} text Free-text reason or symptom answer.
 * @returns {string[]} Canonical symptom labels, in lexicon order; empty when none match.
 */
export function extractSymptoms(text) {
  const cleaned = toText(text).replace(NON_SYMPTOM_MARKERS, ' ');
  if (cleaned.trim() === '') {
    return [];
  }
  const found = [];
  SYMPTOM_LEXICON.forEach((entry) => {
    if (entry.pattern.test(cleaned)) {
      found.push(entry.label);
    }
  });
  return dropGenericPainWhenSpecific_(found);
}

/**
 * Drops the catch-all "Pain (unspecified)" label when a specific symptom also matched.
 *
 * "Knee pain" should count once, under Knee. Keeping both would inflate the generic
 * bucket until it topped the chart and said nothing.
 * @param {string[]} labels Matched labels.
 * @returns {string[]} The labels, with the catch-all removed when redundant.
 */
function dropGenericPainWhenSpecific_(labels) {
  const generic = 'Pain (unspecified)';
  return labels.length > 1 ? labels.filter((label) => label !== generic) : labels;
}

/**
 * Words carrying no signal in a report-sick free-text cloud.
 * @type {!Set<string>}
 */
const STOPWORDS = new Set(
  ('a an and are as at be but by for from had has have he her his i in is it its me my of on or ' +
    'she that the their there they this to was were will with you your am been being do does did doing ' +
    'very really quite bit lot more most much some any all also just still yet not no nor so than then ' +
    'when while who whom whose which what where why how mc hl rsi rso att c b day days feeling feel felt ' +
    'having got get getting since due unable cannot cant experiencing experience symptoms symptom')
    .split(/\s+/)
);

/**
 * Tokenises free text into keywords for the word cloud.
 *
 * The cloud is deliberately built from the soldiers' own words rather than the lexicon,
 * because its job is to surface phrasing the lexicon has not learned yet — the wording
 * that turns into next month's lexicon entry.
 * @param {string} text Free-text reason.
 * @returns {string[]} Lowercased keywords, stopwords and one-character tokens removed.
 */
export function keywords(text) {
  return toText(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}
