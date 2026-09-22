/**
 * FormSG end to end without a database: dummy submissions are encrypted with the real SDK,
 * decrypted by `decryptSubmission` and mapped by `mapSubmission`, and the row must say what the
 * soldier answered -- and never the NRIC FormSG attaches.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { describe, expect, test } from 'bun:test';
import { decryptSubmission, type Decryptors, type WebhookData } from '../../lib/formsg/decrypt.ts';
import { mapSubmission } from '../../lib/formsg/map.ts';
import { expectedRow, FAKE_NRIC, FORM_KEYS, SICK_SPECS, testSdk as sdk, webhookRequest, type SickSpec } from '../support/formsg.ts';

/** The real SDK, as the route hands it to `decryptSubmission`. */
const testSdk = sdk as unknown as Decryptors;

/**
 * The `data` object of a webhook request's body.
 *
 * @param request The request.
 * @returns The payload FormSG sends.
 */
async function payloadOf(request: Request): Promise<WebhookData> {
  return ((await request.json()) as { data: WebhookData }).data;
}

/**
 * Decrypts and maps the payload a real webhook for `spec` would carry.
 *
 * @param spec The submission.
 * @param options Passed to `webhookRequest`.
 * @returns The mapped submission.
 */
async function roundTrip(spec: SickSpec, options: Parameters<typeof webhookRequest>[1] = {}) {
  const data = await payloadOf(webhookRequest(spec, options));
  return mapSubmission(decryptSubmission(data, FORM_KEYS.secretKey, testSdk));
}

describe('a storage-mode submission maps to what was answered', () => {
  test.each(SICK_SPECS.map((spec) => [spec.submissionId, spec] as const))('%s', async (_id, spec) => {
    const { row, unmapped, unrecognised } = await roundTrip(spec);

    expect(row).toMatchObject(Object.fromEntries(Object.entries(expectedRow(spec)).filter(([, value]) => value !== null)));
    expect(row.nameKey).toBeTruthy();
    expect(unmapped).toEqual([]);
    expect(unrecognised).toEqual([]);
    expect(JSON.stringify(row)).not.toContain(FAKE_NRIC);
  });
});

describe('a multi-respondent (v3) submission', () => {
  test('decrypts with the same form key, and still carries no NRIC', async () => {
    const { row } = await roundTrip(SICK_SPECS[0]!, { v3: true });
    expect(row.responseId).toBe(SICK_SPECS[0]!.submissionId);
    expect(JSON.stringify(row)).not.toContain(FAKE_NRIC);
  });
});

describe('a submission encrypted to another form', () => {
  test('cannot be decrypted with this form’s key', async () => {
    const data = await payloadOf(webhookRequest(SICK_SPECS[0]!));
    const otherForm = sdk.crypto.generate();
    expect(() => decryptSubmission(data, otherForm.secretKey, testSdk)).toThrow();
  });
});
