/**
 * Duty classification and symptom extraction.
 * Classification matches the section a person is listed under, never the reason text: every `Att C`
 * row is MC (even "HL" or "FEVER"), and `Status` (light duty) is restricted, not absent.
 */

import { toText } from '../../../shared/values.ts';

/** The duty classes the dashboard reports, one per parade-state section. */
export const DUTY_CLASS = {
  ATT_C: 'Att C',
  REPORT_SICK: 'Report Sick',
  STATUS: 'Status',
  MA: 'MA',
  OFF_LEAVE: 'Off/Leave',
  OTHERS: 'Others',
  UNKNOWN: 'Unknown',
} as const;

export type DutyClass = (typeof DUTY_CLASS)[keyof typeof DUTY_CLASS];

/** The classes the MC / MA page and the Overview's MC / MA tile count together. */
export const MC_MA: DutyClass[] = [DUTY_CLASS.ATT_C, DUTY_CLASS.MA];

/** Whether a duty class is one (or one of several) a view is about. */
export function isDuty(wanted: DutyClass | DutyClass[], dutyClass: DutyClass): boolean {
  return Array.isArray(wanted) ? wanted.includes(dutyClass) : wanted === dutyClass;
}

/** Section to class; an unknown section shows as UNKNOWN rather than silently shrinking totals. */
const CATEGORY_TO_CLASS: Record<string, DutyClass> = {
  'Att C': DUTY_CLASS.ATT_C,
  'Report Sick': DUTY_CLASS.REPORT_SICK,
  Status: DUTY_CLASS.STATUS,
  MA: DUTY_CLASS.MA,
  'Off/Leave': DUTY_CLASS.OFF_LEAVE,
  Others: DUTY_CLASS.OTHERS,
};

/** Whether each class keeps a soldier from duty; Report Sick is an event, not an absence (the MC row follows). */
const EMPLOYABILITY: Record<DutyClass, 'ABSENT' | 'EVENT' | 'RESTRICTED' | 'UNKNOWN'> = {
  [DUTY_CLASS.ATT_C]: 'ABSENT',
  [DUTY_CLASS.REPORT_SICK]: 'EVENT',
  [DUTY_CLASS.STATUS]: 'RESTRICTED',
  [DUTY_CLASS.MA]: 'ABSENT',
  [DUTY_CLASS.OFF_LEAVE]: 'ABSENT',
  [DUTY_CLASS.OTHERS]: 'ABSENT',
  [DUTY_CLASS.UNKNOWN]: 'UNKNOWN',
};

/** The duty class of a personnel row, from its section. */
export function classify(row: { reasonCategory?: string | null } | null | undefined): DutyClass {
  return CATEGORY_TO_CLASS[toText(row?.reasonCategory)] ?? DUTY_CLASS.UNKNOWN;
}

/** Whether a class means the soldier could not be employed that day. */
export function isAbsent(dutyClass: DutyClass): boolean {
  return EMPLOYABILITY[dutyClass] === 'ABSENT';
}

/** Whether a class means present but restricted (light duty). */
export function isRestricted(dutyClass: DutyClass): boolean {
  return EMPLOYABILITY[dutyClass] === 'RESTRICTED';
}

/** Symptom labels and their patterns; specific entries first so "sore throat" is not also generic pain. */
const SYMPTOM_LEXICON: { label: string; pattern: RegExp }[] = [
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

/** The catch-all label, dropped when a specific symptom also matched ("knee pain" counts under Knee). */
const GENERIC_PAIN = 'Pain (unspecified)';

/** Bookkeeping words stripped before matching, so they are not read as symptoms. */
const NON_SYMPTOM_MARKERS = /\b(MC|HL|RSI|RSO|AFMC|Att\s*[ABC])\b/gi;

/** Canonical symptom labels in a free-text reason, each at most once, in lexicon order. */
export function extractSymptoms(text: unknown): string[] {
  const cleaned = toText(text).replace(NON_SYMPTOM_MARKERS, ' ');
  if (cleaned.trim() === '') return [];
  const found = SYMPTOM_LEXICON.filter((entry) => entry.pattern.test(cleaned)).map((entry) => entry.label);
  return found.length > 1 ? found.filter((label) => label !== GENERIC_PAIN) : found;
}

/** Words with no signal in the report-sick word cloud. */
const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from had has have he her his i in is it its me my of on or ' +
    'she that the their there they this to was were will with you your am been being do does did doing ' +
    'very really quite bit lot more most much some any all also just still yet not no nor so than then ' +
    'when while who whom whose which what where why how mc hl rsi rso att c b day days feeling feel felt ' +
    'having got get getting since due unable cannot cant experiencing experience symptoms symptom'
  ).split(/\s+/),
);

/** Lower-cased word-cloud keywords: the soldiers' own words, without stopwords or short tokens. */
export function keywords(text: unknown): string[] {
  return toText(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}
