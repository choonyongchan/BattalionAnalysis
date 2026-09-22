/**
 * Decrypts a FormSG webhook body (v2 or v3) into answers.
 * `verifiedContent`, which holds the NRIC, is never decrypted.
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
 * Anything other than a string or string array is stringified, so it stays visible.
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
    // `verifiedContent` is not passed: it holds the NRIC.
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
    // FormSG's own submission time; receipt time only if it sent none.
    submittedAt: data.created ?? new Date().toISOString(),
    responses,
  };
}
