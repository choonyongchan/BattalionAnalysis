/**
 * Mapping a FormSG submission's answers onto database columns.
 *
 * A webhook delivers answers as `{_id, question, answer, fieldType}`. There are two ways to
 * find the one you want, and they fail differently:
 *
 *   - by field `_id`: stable across wording changes, but the ids have to be harvested from
 *     a real submission and cannot be derived from anything in this repository;
 *   - by question title: available immediately, but breaks silently the moment someone
 *     edits the question wording in the FormSG editor.
 *
 * So both are supported: ids take precedence when known, titles are the fallback, and an
 * answer matching neither is logged by name rather than dropped quietly.
 *
 * Titles are compared after normalisation, which matters for one question in particular.
 * "I am experiencing _____________________ symptoms." contains a run of underscores whose
 * length nobody can verify by eye, and an off-by-one would silently discard every symptom
 * answer. Runs of underscores are collapsed before comparison so the count cannot matter.
 */

/** A column this pipeline knows how to fill. */
export type CanonicalField =
  | 'rank'
  | 'name'
  | 'fourD'
  | 'unitCoy'
  | 'reportSickTime'
  | 'reportSickType'
  | 'reason'
  | 'symptoms'
  | 'declarationGenuine'
  | 'outcome'
  | 'mcDays'
  | 'statusGiven'
  | 'statusDays'
  /** Recognised so it can be discarded on purpose rather than by omission. */
  | 'discard';

/**
 * Normalises a question title for comparison.
 *
 * @param title A question title, from a webhook or the CSV export.
 * @returns Lower-cased, with underscore runs and whitespace runs each collapsed to one.
 */
export function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/_+/g, '_').replace(/\s+/g, ' ').trim();
}

/**
 * Question titles as they appear in the live form, mapped to columns.
 *
 * Copied from a real export rather than retyped. `Status Given #2`..`#5` and their day
 * counts all map to the same pair of canonical fields; the repetition index is recovered
 * from the title so they become rows in `formsg_statuses` instead of ten flat columns.
 */
const TITLE_MAP: Record<string, CanonicalField> = Object.fromEntries(
  (
    [
      ['Rank', 'rank'],
      ['[Myinfo] Name', 'name'],
      ['4D Number (REC Only)', 'fourD'],
      ['Unit & Coy', 'unitCoy'],
      ['Report Sick Time', 'reportSickTime'],
      ['Report Sick Type', 'reportSickType'],
      ['Reason for Reporting Sick (Keep Brief)', 'reason'],
      ['I am experiencing _ symptoms.', 'symptoms'],
      ['My symptoms are genuine and I have updated my Commander of my condition.', 'declarationGenuine'],
      ['Outcome given by the doctor/MO', 'outcome'],
      ['Days given for Sick Leave / MC', 'mcDays'],
      ['Status Given', 'statusGiven'],
      ['Days given for Status', 'statusDays'],
      // Present in the export, deliberately not stored. Listed so an unexpected-field
      // warning does not fire for them every single submission.
      ['SingPass Validated NRIC', 'discard'],
      ['Masked NRIC', 'discard'],
      ['Download Status', 'discard'],
    ] as Array<[string, CanonicalField]>
  ).map(([title, field]) => [normaliseTitle(title), field]),
);

/**
 * Field ids harvested from a real submission.
 *
 * Empty until someone captures one -- see the migration plan's open items. Filling this in
 * makes the mapping immune to a wording change in the FormSG editor; until then the title
 * fallback carries it. Add entries as `'<24-char id>': 'rank'`.
 */
export const FIELD_IDS: Record<string, CanonicalField> = {};

/** `Status Given #3` and `Days given for Status #3` both carry repetition index 3. */
const REPEAT_SUFFIX = /#(\d+)\s*$/;

/** What an answer was recognised as. */
export interface ResolvedField {
  field: CanonicalField;
  /** 1 for the first status pair, 2..5 for the repeats. */
  index: number;
}

/**
 * Identifies which column an answer belongs to.
 *
 * @param answer The `_id` and `question` from a webhook response entry.
 * @returns The column and repetition index, or null when the answer is not recognised.
 */
export function resolveField(answer: { _id?: string; question?: string }): ResolvedField | null {
  if (answer._id && FIELD_IDS[answer._id]) {
    return { field: FIELD_IDS[answer._id]!, index: 1 };
  }
  if (!answer.question) return null;

  const repeat = REPEAT_SUFFIX.exec(answer.question);
  const index = repeat ? Number(repeat[1]) : 1;
  const base = repeat ? answer.question.slice(0, repeat.index) : answer.question;

  const field = TITLE_MAP[normaliseTitle(base)];
  return field ? { field, index } : null;
}

/* ------------------------------------------------------- value vocabularies */

/**
 * The form's report-sick options, mapped onto the shared enum.
 *
 * Both data streams use this vocabulary, which is what lets a FormSG submission and a
 * parade-state entry be compared at all.
 */
const REPORT_SICK_TYPES: Record<string, string> = {
  'report sick in-camp (rsi)': 'RSI',
  'report sick outside (rso)': 'RSO',
  'medical review': 'MR',
  ffi: 'FFI',
};

/** The outcome options from the section added on 2026-09-16. */
const OUTCOMES: Record<string, string> = {
  'sick leave / mc': 'MC',
  'status (e.g excuse..., rest in bunk)': 'Status',
  'both sick leave & status': 'Both',
  none: 'None',
};

/**
 * Maps a report-sick answer to the enum value.
 *
 * @param answer The raw answer text.
 * @returns The enum value, or null when unrecognised -- which is reported, never guessed.
 */
export function toReportSickType(answer: string | null | undefined): string | null {
  if (!answer) return null;
  return REPORT_SICK_TYPES[normaliseTitle(answer)] ?? null;
}

/**
 * Maps an outcome answer to the enum value.
 *
 * Matched on a prefix as well as exactly, because the `Status (e.g Excuse...)` option text
 * is long, contains an ellipsis and has already been edited once.
 *
 * @param answer The raw answer text.
 * @returns The enum value, or null when unrecognised.
 */
export function toOutcome(answer: string | null | undefined): string | null {
  if (!answer) return null;
  const value = normaliseTitle(answer);
  if (OUTCOMES[value]) return OUTCOMES[value]!;
  if (value.startsWith('both')) return 'Both';
  if (value.startsWith('status')) return 'Status';
  if (value.startsWith('sick leave')) return 'MC';
  if (value === 'none') return 'None';
  return null;
}

/** The prefix FormSG uses when a respondent picks "Others" and types their own text. */
const OTHERS_PREFIX = /^others:\s*/i;

/**
 * Splits a pick-list answer into a canonical option and free text.
 *
 * @param answer The raw answer.
 * @returns `option` when the answer is one of the form's choices, or `otherText` when the
 *   respondent typed their own. Both null for a blank answer.
 */
export function splitOtherOption(answer: string | null | undefined): {
  option: string | null;
  otherText: string | null;
} {
  if (!answer || !answer.trim()) return { option: null, otherText: null };
  if (OTHERS_PREFIX.test(answer)) {
    return { option: null, otherText: answer.replace(OTHERS_PREFIX, '').trim() || null };
  }
  return { option: answer.trim(), otherText: null };
}

/**
 * Parses the `Yes`/`No` attestation.
 *
 * @param answer The raw answer.
 * @returns true, false, or null when the question was not answered.
 */
export function toBoolean(answer: string | null | undefined): boolean | null {
  if (!answer) return null;
  const value = answer.trim().toLowerCase();
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

/**
 * Parses a small whole number from a text answer.
 *
 * The day-count questions come through as text, and a respondent may type "3 days".
 *
 * @param answer The raw answer.
 * @returns The number, or null when the answer holds none.
 */
export function toSmallInt(answer: string | null | undefined): number | null {
  if (!answer) return null;
  const match = /-?\d+/.exec(answer);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses an `HHMM` or `HH:MM` time answer.
 *
 * @param answer The raw answer, e.g. "1400".
 * @returns `HH:MM`, or null when the answer is not a time.
 */
export function toTime(answer: string | null | undefined): string | null {
  if (!answer) return null;
  const digits = answer.replace(/\D/g, '');
  if (digits.length !== 4) return null;
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > 23 || minutes > 59) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
