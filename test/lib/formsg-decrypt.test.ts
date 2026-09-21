/**
 * Webhook payload decryption and crypto-version dispatch.
 *
 * The version is detected from the payload rather than configured, so these tests are the
 * specification for that detection: which decryptor runs, what it is handed, and -- most
 * importantly -- what it is NOT handed.
 */
import { describe, expect, test } from 'bun:test';
import { DecryptError, decryptSubmission, type Decryptors } from '../../lib/formsg/decrypt.ts';

/** What each decryptor was called with, so a test can assert on the arguments. */
interface Calls {
  v2: unknown[];
  v3: unknown[];
}

/**
 * Builds stub decryptors that record their arguments.
 *
 * @param v2Result What `crypto.decrypt` should return.
 * @param v3Result What `cryptoV3.decrypt` should return.
 * @returns The decryptors and the call log.
 */
function stubs(v2Result: unknown, v3Result: unknown): { decryptors: Decryptors; calls: Calls } {
  const calls: Calls = { v2: [], v3: [] };
  return {
    calls,
    decryptors: {
      crypto: {
        decrypt: (_key: string, params: unknown) => {
          calls.v2.push(params);
          return v2Result as any;
        },
      },
      cryptoV3: {
        decrypt: (_key: string, params: unknown) => {
          calls.v3.push(params);
          return v3Result as any;
        },
      },
    },
  };
}

/** A storage-mode payload: encrypted content, no wrapped submission key. */
const V2 = {
  formId: 'form-1',
  submissionId: 'sub-1',
  encryptedContent: 'ciphertext',
  verifiedContent: 'verified-ciphertext',
  version: 1,
  created: '2026-09-18T08:31:00.000+08:00',
};

/** A multi-respondent payload: the wrapped submission key is the discriminator. */
const V3 = { ...V2, encryptedSubmissionSecretKey: 'wrapped-key', version: 3 };

describe('validation', () => {
  test('refuses a payload missing its submission id or ciphertext', () => {
    const { decryptors } = stubs({ responses: [] }, null);
    expect(() => decryptSubmission({ encryptedContent: 'x' }, 'key', decryptors)).toThrow(
      DecryptError,
    );
    expect(() => decryptSubmission({ submissionId: 'sub-1' }, 'key', decryptors)).toThrow(
      DecryptError,
    );
  });

  test('turns a null decryption into a DecryptError rather than a null submission', () => {
    const { decryptors } = stubs(null, null);
    expect(() => decryptSubmission(V2, 'key', decryptors)).toThrow(DecryptError);
  });
});

describe('version dispatch', () => {
  test('uses v2 when there is no wrapped submission key', () => {
    const { decryptors, calls } = stubs({ responses: [] }, null);
    decryptSubmission(V2, 'key', decryptors);
    expect(calls.v2).toHaveLength(1);
    expect(calls.v3).toHaveLength(0);
  });

  test('uses v3 when there is one', () => {
    const { decryptors, calls } = stubs(null, { responses: {} });
    decryptSubmission(V3, 'key', decryptors);
    expect(calls.v3).toHaveLength(1);
    expect(calls.v2).toHaveLength(0);
    expect(calls.v3[0]).toMatchObject({ encryptedSubmissionSecretKey: 'wrapped-key' });
  });

  test('NEVER passes verifiedContent to either decryptor', () => {
    /*
     * `verifiedContent` is where `uinFin` lives. The SDK only opens it when asked, so not
     * asking is the cheapest possible guarantee that the NRIC is not decrypted at all --
     * strictly stronger than decrypting it and then discarding it.
     */
    const { decryptors, calls } = stubs({ responses: [] }, { responses: {} });
    decryptSubmission(V2, 'key', decryptors);
    decryptSubmission(V3, 'key', decryptors);

    for (const params of [...calls.v2, ...calls.v3]) {
      expect(params).not.toHaveProperty('verifiedContent');
    }
  });

  test('does not carry verified content into the result either', () => {
    const { decryptors } = stubs({ responses: [], verified: { uinFin: 'T0000001A' } }, null);
    const result = decryptSubmission(V2, 'key', decryptors);
    expect(JSON.stringify(result)).not.toContain('T0000001A');
  });
});

describe('v3 answer shaping', () => {
  test('keys answers by field id, because v3 carries no question text', () => {
    const { decryptors } = stubs(null, {
      responses: { abc123: { fieldType: 'textfield', answer: 'CPL' } },
    });
    const result = decryptSubmission(V3, 'key', decryptors);
    expect(result.responses[0]).toEqual({
      _id: 'abc123',
      fieldType: 'textfield',
      answer: 'CPL',
    });
    // No question, so title matching cannot work: a v3 form needs FIELD_IDS harvested.
    expect(result.responses[0]!.question).toBeUndefined();
  });

  test('passes a flat string array through as answerArray', () => {
    const { decryptors } = stubs(null, {
      responses: { a: { fieldType: 'checkbox', answer: ['Fever', 'Cough'] } },
    });
    expect(decryptSubmission(V3, 'key', decryptors).responses[0]!.answerArray).toEqual([
      'Fever',
      'Cough',
    ]);
  });

  test('renders numbers, booleans and nested shapes as text rather than dropping them', () => {
    // An unexpected field type should be visible as odd text, not vanish or throw.
    const { decryptors } = stubs(null, {
      responses: {
        a: { fieldType: 'number', answer: 2 },
        b: { fieldType: 'yes_no', answer: true },
        c: { fieldType: 'table', answer: [{ x: 1 }] },
        d: { fieldType: 'textfield', answer: null },
      },
    });
    const responses = decryptSubmission(V3, 'key', decryptors).responses;
    expect(responses[0]!.answer).toBe('2');
    expect(responses[1]!.answer).toBe('true');
    expect(responses[2]!.answerArray).toEqual(['{"x":1}']);
    expect(responses[3]!.answer).toBe('');
  });
});

describe('timestamps', () => {
  test("keeps FormSG's own offset-aware submission time", () => {
    // Storing receipt time instead would file a redelivered submission under the wrong day.
    const { decryptors } = stubs({ responses: [] }, null);
    expect(decryptSubmission(V2, 'key', decryptors).submittedAt).toBe(
      '2026-09-18T08:31:00.000+08:00',
    );
  });

  test('falls back to now only when FormSG sent no timestamp', () => {
    const { decryptors } = stubs({ responses: [] }, null);
    const { created, ...withoutCreated } = V2;
    expect(decryptSubmission(withoutCreated, 'key', decryptors).submittedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });
});
