/**
 * Turning a FormSG webhook body into answers this pipeline can map.
 *
 * NRIC IS DISCARDED HERE, at the first point the plaintext exists. FormSG returns identity
 * two ways -- as a `SingPass Validated NRIC` answer among the responses, and as
 * `verified.uinFin` / `verified.sgidUinFin` beside them. `lib/formsg/map.ts` drops the first
 * by name; this module drops the second by never reading the `verified` object at all.
 * Neither ever reaches a row, because no column exists to hold one.
 *
 * WHICH CRYPTO VERSION. The v8 SDK exposes two decryptors and the answer is not a matter of
 * taste: a storage-mode form delivers `encryptedContent` alone, and a multi-respondent form
 * delivers `encryptedContent` plus `encryptedSubmissionSecretKey`. The payload therefore
 * says which it is, so the version is detected rather than configured -- one less thing to
 * set wrong, and a form migrated between modes keeps working.
 *
 * The two produce differently shaped answers, and the difference is load-bearing:
 *
 *   - v2 gives `{_id, question, answer}`. Both the id and the title are available, so
 *     `resolveField` can fall back to title matching and the pipeline works today.
 *   - v3 gives `{[fieldId]: {fieldType, answer}}` -- keyed by id, WITH NO QUESTION TEXT.
 *     Title matching is impossible by construction, so a v3 form needs `FIELD_IDS` in
 *     `fields.ts` populated from a real submission or every answer maps to nothing.
 *
 * That is why an unmapped-answer count is returned rather than logged and forgotten: on a v3
 * form it is the difference between working and silently storing empty rows.
 */
import type { DecryptedSubmission, FormSgAnswer } from './map.ts';

/** The `data` object a FormSG webhook POSTs. */
export interface WebhookData {
  formId?: string;
  submissionId?: string;
  encryptedContent?: string;
  encryptedSubmissionSecretKey?: string;
  verifiedContent?: string;
  version?: number;
  created?: string;
}

/** The decryptors this module needs, which is a subset of what `formsg()` returns. */
export interface Decryptors {
  crypto: { decrypt(formSecretKey: string, params: any): { responses: FormSgAnswer[] } | null };
  cryptoV3: {
    decrypt(
      formSecretKey: string,
      params: any,
    ): { responses: Record<string, { fieldType?: string; answer?: unknown }> } | null;
  };
}

/** Raised when a payload cannot be decrypted or is not shaped like a submission. */
export class DecryptError extends Error {
  /**
   * @param message What went wrong, safe to log but not to return to a caller.
   */
  constructor(message: string) {
    super(message);
    this.name = 'DecryptError';
  }
}

/**
 * Flattens one v3 answer into the `{answer, answerArray}` shape the mapper reads.
 *
 * A v3 answer is typed `any` because a table or children field nests arrays. Those field
 * types do not appear on this form, so rather than model them, anything that is not a string
 * or a flat string array is stringified -- which keeps an unexpected field visible as odd
 * text instead of throwing or vanishing.
 *
 * @param answer The raw v3 answer.
 * @returns The answer in webhook shape.
 */
function flattenV3Answer(answer: unknown): Pick<FormSgAnswer, 'answer' | 'answerArray'> {
  if (answer === null || answer === undefined) return { answer: '' };
  if (typeof answer === 'string') return { answer };
  if (Array.isArray(answer)) {
    if (answer.every((item) => typeof item === 'string')) return { answerArray: answer as string[] };
    return { answerArray: answer.map((item) => JSON.stringify(item)) };
  }
  if (typeof answer === 'number' || typeof answer === 'boolean') return { answer: String(answer) };
  return { answer: JSON.stringify(answer) };
}

/**
 * Decrypts a webhook payload into answers.
 *
 * @param data The webhook's `data` object.
 * @param formSecretKey The form's base-64 secret key.
 * @param decryptors The SDK's `crypto` and `cryptoV3`.
 * @returns The submission, with `verified` deliberately absent.
 * @throws {DecryptError} If the payload is malformed or decryption fails.
 */
export function decryptSubmission(
  data: WebhookData,
  formSecretKey: string,
  decryptors: Decryptors,
): DecryptedSubmission {
  if (!data || typeof data !== 'object') throw new DecryptError('The payload has no data object.');
  if (!data.submissionId) throw new DecryptError('The payload has no submissionId.');
  if (!data.encryptedContent) throw new DecryptError('The payload has no encryptedContent.');

  const isV3 = typeof data.encryptedSubmissionSecretKey === 'string';
  let responses: FormSgAnswer[];

  if (isV3) {
    /*
     * `verifiedContent` is deliberately not passed. It is where `uinFin` lives, and the SDK
     * only opens it when asked, so not asking is the cheapest possible guarantee that the
     * NRIC is never decrypted in the first place.
     */
    const decrypted = decryptors.cryptoV3.decrypt(formSecretKey, {
      encryptedContent: data.encryptedContent,
      encryptedSubmissionSecretKey: data.encryptedSubmissionSecretKey!,
      version: data.version ?? 3,
    });
    if (!decrypted) throw new DecryptError('Decryption returned null (v3).');

    responses = Object.entries(decrypted.responses ?? {}).map(([fieldId, field]) => ({
      _id: fieldId,
      fieldType: field?.fieldType,
      ...flattenV3Answer(field?.answer),
    }));
  } else {
    const decrypted = decryptors.crypto.decrypt(formSecretKey, {
      encryptedContent: data.encryptedContent,
      version: data.version ?? 1,
    });
    if (!decrypted) throw new DecryptError('Decryption returned null (v2).');
    responses = decrypted.responses ?? [];
  }

  return {
    submissionId: data.submissionId,
    formId: data.formId,
    /*
     * `created` is FormSG's own offset-aware timestamp for the submission. Falling back to
     * now() would silently file a replayed submission under the wrong day, so the fallback
     * exists only because the column is NOT NULL, and it is the receipt time by definition
     * when FormSG sent no other.
     */
    submittedAt: data.created ?? new Date().toISOString(),
    responses,
  };
}
