/**
 * Maps FormSG question titles onto `report_sick_formsg` columns, and parses answer values.
 *
 * Answers are matched by field `_id` when known, else by normalised question title.
 */

/** Columns filled straight from an answer; `discard` marks titles dropped on purpose. */
export type Column =
  | 'rank'
  | 'name'
  | 'fourD'
  | 'unitCoy'
  | 'reportSickTime'
  | 'reportSickType'
  | 'reason'
  | 'symptoms'
  | 'genuine'
  | 'outcome'
  | 'mcDays'
  | `status${1 | 2 | 3 | 4 | 5}`
  | `status${1 | 2 | 3 | 4 | 5}Days`
  | 'discard';

/**
 * Normalises a question title or option for comparison.
 *
 * Underscore runs collapse too, so the blank in the symptoms question can be any length.
 *
 * @param title A question title or answer option.
 * @returns Lower-cased, with underscore and whitespace runs each collapsed to one.
 */
export function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/_+/g, '_').replace(/\s+/g, ' ').trim();
}

/** Question titles as they appear in the live form. Status titles carry a `#n` suffix. */
const TITLE_MAP: Record<string, Column | 'status' | 'statusDays'> = Object.fromEntries(
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
      ['My symptoms are genuine and I have updated my Commander of my condition.', 'genuine'],
      ['Outcome given by the doctor/MO', 'outcome'],
      ['Days given for Sick Leave / MC', 'mcDays'],
      ['Status Given', 'status'],
      ['Days given for Status', 'statusDays'],
      // Known but not stored, so they do not trip the unmapped-question warning.
      ['SingPass Validated NRIC', 'discard'],
      ['Masked NRIC', 'discard'],
      ['Download Status', 'discard'],
    ] as const
  ).map(([title, column]) => [normaliseTitle(title), column]),
);

/**
 * Field ids harvested from a real submission, as `'<24-char id>': 'rank'`.
 *
 * Required for v3 (multi-respondent) payloads, which carry no question text.
 */
export const FIELD_IDS: Record<string, Column> = {};

/** The `#3` in `Status Given #3`. */
const REPEAT_SUFFIX = /\s*#(\d+)\s*$/;

/**
 * Identifies which column an answer belongs to.
 *
 * @param answer The `_id` and `question` from a webhook response entry.
 * @returns The column, or null when the answer is not recognised.
 */
export function resolveField(answer: { _id?: string; question?: string }): Column | null {
  if (answer._id && FIELD_IDS[answer._id]) return FIELD_IDS[answer._id]!;
  if (!answer.question) return null;

  const repeat = REPEAT_SUFFIX.exec(answer.question);
  const index = repeat ? Number(repeat[1]) : 1;
  const base = repeat ? answer.question.slice(0, repeat.index) : answer.question;
  const column = TITLE_MAP[normaliseTitle(base)];

  if (column === 'status' || column === 'statusDays') {
    if (index < 1 || index > 5) return null;
    return (column === 'status' ? `status${index}` : `status${index}Days`) as Column;
  }
  return column ?? null;
}

/* ------------------------------------------------------- value vocabularies */

/** The form's report-sick options, mapped onto the shared enum. */
const REPORT_SICK_TYPES: Record<string, string> = {
  'report sick in-camp (rsi)': 'RSI',
  'report sick outside (rso)': 'RSO',
  'medical review': 'MR',
  ffi: 'FFI',
};

/**
 * Maps a report-sick answer to the enum value.
 *
 * @param answer The raw answer text.
 * @returns The enum value, or null when unrecognised.
 */
export function toReportSickType(answer: string | null | undefined): string | null {
  if (!answer) return null;
  return REPORT_SICK_TYPES[normaliseTitle(answer)] ?? null;
}

/**
 * Maps an outcome answer to the enum value, by prefix since the option text gets edited.
 *
 * @param answer The raw answer text.
 * @returns The enum value, or null when unrecognised.
 */
export function toOutcome(answer: string | null | undefined): string | null {
  if (!answer) return null;
  const value = normaliseTitle(answer);
  if (value.startsWith('both')) return 'Both';
  if (value.startsWith('status')) return 'Status';
  if (value.startsWith('sick leave')) return 'MC';
  if (value === 'none') return 'None';
  return null;
}

/** The prefix FormSG uses when a respondent picks "Others" and types their own text. */
const OTHERS_PREFIX = /^others:\s*/i;

/**
 * Splits a pick-list answer into its option and any free text.
 *
 * @param answer The raw answer.
 * @returns `option` is the chosen option, or `Others`; `otherText` is the typed text.
 */
export function splitOtherOption(answer: string | null | undefined): {
  option: string | null;
  otherText: string | null;
} {
  if (!answer || !answer.trim()) return { option: null, otherText: null };
  if (OTHERS_PREFIX.test(answer)) {
    return { option: 'Others', otherText: answer.replace(OTHERS_PREFIX, '').trim() || null };
  }
  return { option: answer.trim(), otherText: null };
}

/**
 * Parses a `Yes`/`No` answer.
 *
 * @param answer The raw answer.
 * @returns true, false, or null when unanswered or unrecognised.
 */
export function toBoolean(answer: string | null | undefined): boolean | null {
  const value = answer?.trim().toLowerCase();
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

/**
 * Parses a whole number from a text answer such as "3 days".
 *
 * @param answer The raw answer.
 * @returns The number, or null when the answer holds none.
 */
export function toSmallInt(answer: string | null | undefined): number | null {
  const match = answer ? /-?\d+/.exec(answer) : null;
  return match ? Number(match[0]) : null;
}

/**
 * Parses an `HHMM` or `HH:MM` time answer.
 *
 * @param answer The raw answer, e.g. "1400".
 * @returns `HH:MM`, or null when the answer is not a valid time.
 */
export function toTime(answer: string | null | undefined): string | null {
  const digits = answer?.replace(/\D/g, '') ?? '';
  if (digits.length !== 4) return null;
  const [hours, minutes] = [digits.slice(0, 2), digits.slice(2)];
  return Number(hours) <= 23 && Number(minutes) <= 59 ? `${hours}:${minutes}` : null;
}

/** Singapore is UTC+8 all year. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * Gives the Singapore-local calendar date of an instant.
 *
 * @param iso An ISO 8601 timestamp with an offset.
 * @returns `YYYY-MM-DD` in Singapore time.
 * @throws {RangeError} If `iso` is not a valid timestamp.
 */
export function toSgtDate(iso: string): string {
  return new Date(Date.parse(iso) + SGT_OFFSET_MS).toISOString().slice(0, 10);
}
