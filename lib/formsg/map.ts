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
  submission: Record<string, unknown>;
  statuses: Array<Record<string, unknown>>;
  /** Question titles that matched no known column, for logging rather than silence. */
  unmapped: string[];
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

    reportSickType: toReportSickType(single.get('reportSickType')),
    reportSickTime: toTime(single.get('reportSickTime')),
    reason: single.get('reason') || null,
    symptomCategoryId: symptom.option ? (symptomIdByLabel.get(symptom.option) ?? null) : null,
    // An option that is not in the lookup is kept as free text rather than thrown away, so
    // a newly added form option shows up as an unfamiliar string instead of a null.
    symptomOtherText:
      symptom.otherText ??
      (symptom.option && !symptomIdByLabel.has(symptom.option) ? symptom.option : null),
    attestedGenuine: toBoolean(single.get('declarationGenuine')),

    outcome: toOutcome(single.get('outcome')),
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

  return { submission, statuses, unmapped };
}
