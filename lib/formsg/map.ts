/** Turns a decrypted FormSG submission into one `report_sick_formsg` row; NRIC answers are discarded. */
import { companyFromUnitCoy, normaliseName } from '../domain.ts';
import {
  resolveField,
  splitOtherOption,
  toBoolean,
  toOutcome,
  toReportSickType,
  toSgtDate,
  toSmallInt,
  toTime,
  type Column,
} from './fields.ts';

/** One answer as FormSG delivers it. */
export interface FormSgAnswer {
  _id?: string;
  question?: string;
  answer?: string;
  answerArray?: string[];
  fieldType?: string;
}

/** A decrypted submission, plus the envelope fields the webhook carries. */
export interface DecryptedSubmission {
  submissionId: string;
  formId?: string;
  submittedAt: string;
  responses: FormSgAnswer[];
}

/** The mapped row, plus what could not be placed. */
export interface MappedSubmission {
  row: { responseId: string } & Record<string, unknown>;
  /** Question titles that matched no column. */
  unmapped: string[];
  /** Answers given but matching no known option, as `column=value`. */
  unrecognised: string[];
}

type Parser = (answer: string) => unknown;

/** Typed columns and their parsers. Every other column stores the answer text as is. */
const PARSERS: Partial<Record<Column, Parser>> = {
  reportSickTime: toTime,
  reportSickType: toReportSickType,
  genuine: toBoolean,
  outcome: toOutcome,
  mcDays: toSmallInt,
  ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`status${n}Days`, toSmallInt])),
};

/** Enum columns whose unparseable answers are reported, since a renamed option nulls them. */
const REPORTED = new Set<Column>(['reportSickType', 'outcome']);

/**
 * Reads an answer's text, joining a checkbox answer's selections with `; `.
 *
 * @param answer The answer entry.
 * @returns The answer text, or '' when there is none.
 */
function answerText(answer: FormSgAnswer): string {
  if (answer.answerArray?.length) return answer.answerArray.filter(Boolean).join('; ');
  return (answer.answer ?? '').trim();
}

/**
 * Maps a decrypted submission to an insert-shaped row.
 *
 * @param decrypted The submission, already decrypted and signature-checked.
 * @returns The row, unmapped question titles, and unrecognised answers.
 */
export function mapSubmission(decrypted: DecryptedSubmission): MappedSubmission {
  const answers = new Map<Column, string>();
  const unmapped: string[] = [];
  const unrecognised: string[] = [];

  for (const answer of decrypted.responses ?? []) {
    const column = resolveField(answer);
    if (!column) {
      if (answer.question) unmapped.push(answer.question);
    } else if (column !== 'discard') {
      answers.set(column, answerText(answer));
    }
  }

  const values: Record<string, unknown> = {};
  for (const [column, text] of answers) {
    const parse = PARSERS[column];
    const value = parse ? parse(text) : text || null;
    if (value === null && text && REPORTED.has(column)) unrecognised.push(`${column}=${text}`);
    values[column] = value;
  }

  const symptom = splitOtherOption(answers.get('symptoms'));
  const row = {
    responseId: decrypted.submissionId,
    timestamp: decrypted.submittedAt,
    ...values,
    nameKey: normaliseName(answers.get('name')),
    company: companyFromUnitCoy(answers.get('unitCoy')),
    reportSickDate: toSgtDate(decrypted.submittedAt),
    symptomCategory: symptom.option,
    symptomOtherText: symptom.otherText,
  };

  return { row, unmapped, unrecognised };
}
