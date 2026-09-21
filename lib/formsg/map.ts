/**
 * Turns a decrypted FormSG submission into database rows.
 *
 * NRIC NEVER LEAVES THIS MODULE. FormSG returns `SingPass Validated NRIC` as an answer and
 * may also return `verified.uinFin` / `verified.sgidUinFin` alongside the responses. All of
 * them are discarded here, before anything is built, and `buildSubmission` has no column to
 * put one in. Identity is `name_key`, a normalised name, which was verified 1:1 with NRIC
 * across all 803 people in a 2,376-response export.
 */
import { companyFromUnitCoy, normaliseFourD, normaliseName } from '../domain.ts';
import {
  resolveField,
  splitOtherOption,
  toBoolean,
  toOutcome,
  toReportSickType,
  toSmallInt,
  toTime,
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

/** The rows one submission produces. */
export interface MappedSubmission {
  /**
   * The submission row.
   *
   * `responseId` is named in the type rather than left to the index signature because callers
   * key the child rows on it, and `unknown` there would push every one of them into a cast.
   */
  submission: { responseId: string } & Record<string, unknown>;
  statuses: Array<Record<string, unknown>>;
  /** Question titles that matched no known column, for logging rather than silence. */
  unmapped: string[];
  /**
   * Answers that were given but matched no known option, as `field=value`.
   *
   * A different failure from `unmapped`, and a quieter one. An unmapped question means a
   * column stays null because nobody has mapped it yet. An unrecognised VALUE means the
   * question was found, was answered, and the answer was thrown away -- which is what
   * happens the day someone edits `Report Sick In-Camp (RSI)` in the FormSG editor. Nothing
   * else would report it: the column simply becomes null on every submission from then on.
   */
  unrecognised: string[];
}

/**
 * Reads an answer's text, flattening the multi-select shape FormSG uses for checkboxes.
 *
 * The symptoms question behaves as single-select today -- not one of 2,376 responses used
 * the `;` separator -- but the question is worded as a blank to fill and could be switched
 * to checkboxes without warning. Joining rather than taking the first means such a switch
 * degrades to a longer string rather than silently discarding every answer but one.
 *
 * @param answer The answer entry.
 * @returns The answer text, or '' when there is none.
 */
function answerText(answer: FormSgAnswer): string {
  if (Array.isArray(answer.answerArray) && answer.answerArray.length > 0) {
    return answer.answerArray.filter(Boolean).join('; ');
  }
  return (answer.answer ?? '').trim();
}

/**
 * Maps a decrypted submission to insert-shaped rows.
 *
 * @param decrypted The submission, already decrypted and signature-checked.
 * @param symptomIdByLabel The `symptom_categories` lookup, label to id.
 * @returns The submission row, its status child rows, and any unmapped question titles.
 */
export function mapSubmission(
  decrypted: DecryptedSubmission,
  symptomIdByLabel: Map<string, number>,
): MappedSubmission {
  /** Canonical field -> answer text, and for statuses, index -> answer text. */
  const single = new Map<string, string>();
  const statusGiven = new Map<number, string>();
  const statusDays = new Map<number, string>();
  const unmapped: string[] = [];

  for (const answer of decrypted.responses ?? []) {
    const resolved = resolveField(answer);
    if (!resolved) {
      if (answer.question) unmapped.push(answer.question);
      continue;
    }
    if (resolved.field === 'discard') continue;

    const text = answerText(answer);
    if (resolved.field === 'statusGiven') {
      if (text) statusGiven.set(resolved.index, text);
    } else if (resolved.field === 'statusDays') {
      if (text) statusDays.set(resolved.index, text);
    } else {
      single.set(resolved.field, text);
    }
  }

  const name = single.get('name') ?? '';
  const symptom = splitOtherOption(single.get('symptoms'));

  const unrecognised: string[] = [];

  /**
   * Applies a vocabulary mapper, noting an answer it could not place.
   *
   * Only a non-empty answer counts: an unanswered optional question mapping to null is
   * normal and must not drown the signal from a renamed option.
   *
   * @param field The canonical field name, for the report.
   * @param map The mapper to apply.
   * @returns The mapped value, or null.
   */
  function mapped<T>(field: string, map: (answer: string | undefined) => T | null): T | null {
    const answer = single.get(field);
    const value = map(answer);
    if (value === null && answer && answer.trim() !== '') {
      unrecognised.push(`${field}=${answer}`);
    }
    return value;
  }

  const submission = {
    responseId: decrypted.submissionId,
    formId: decrypted.formId ?? null,
    submittedAt: decrypted.submittedAt,

    rank: single.get('rank') || null,
    name: name || null,
    nameKey: normaliseName(name),
    fourD: single.get('fourD') || null,
    fourDNormalised: normaliseFourD(single.get('fourD')),
    company: companyFromUnitCoy(single.get('unitCoy')),

    reportSickType: mapped('reportSickType', toReportSickType),
    reportSickTime: toTime(single.get('reportSickTime')),
    reason: single.get('reason') || null,
    symptomCategoryId: symptom.option ? (symptomIdByLabel.get(symptom.option) ?? null) : null,
    // An option that is not in the lookup is kept as free text rather than thrown away, so
    // a newly added form option shows up as an unfamiliar string instead of a null.
    symptomOtherText:
      symptom.otherText ??
      (symptom.option && !symptomIdByLabel.has(symptom.option) ? symptom.option : null),
    attestedGenuine: toBoolean(single.get('declarationGenuine')),

    outcome: mapped('outcome', toOutcome),
    mcDays: toSmallInt(single.get('mcDays')),
  };

  /*
   * One row per status actually given. The export's ten flat columns are eight-tenths empty;
   * a child table means a sixth status needs no schema change. Indices are renumbered from 1
   * so a form that skips #2 does not leave a hole.
   */
  const statuses = [...statusGiven.keys()]
    .sort((a, b) => a - b)
    .map((index, position) => ({
      responseId: decrypted.submissionId,
      seq: position + 1,
      statusLabel: statusGiven.get(index)!,
      days: toSmallInt(statusDays.get(index)),
    }));

  return { submission, statuses, unmapped, unrecognised };
}
