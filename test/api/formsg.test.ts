/**
 * The report-sick webhook.
 *
 * The privacy assertions are the point of this file. FormSG hands over identity two ways --
 * as a `SingPass Validated NRIC` answer and as `verified.uinFin` beside the responses -- and
 * the pipeline must drop both. Every other test here exists to make sure the route reaches
 * the code that drops them.
 *
 * Status codes are checked deliberately, because FormSG retries a non-2xx. A payload that
 * can never succeed must answer 4xx or FormSG will redeliver it until it gives up.
 */
import { describe, expect, test } from 'bun:test';
import formsgSdk from '@opengovsg/formsg-sdk';
import { handle, type Deps } from '../../api/formsg.ts';

const SECRET_KEY = 'a-base64-looking-secret-key';
const POST_URI = 'https://example.test/api/formsg';

/**
 * A realistic decrypted response set, including the two identity fields that must be dropped.
 *
 * `T0000001A` is NRIC-shaped on purpose: a placeholder that is not NRIC-shaped would prove
 * nothing about a pipeline whose whole job is to strip NRIC-shaped values.
 */
const RESPONSES = [
  { _id: 'f1', question: 'Rank', answer: 'CPL', fieldType: 'dropdown' },
  { _id: 'f2', question: '[Myinfo] Name', answer: 'TAN AH KOW', fieldType: 'textfield' },
  { _id: 'f3', question: 'SingPass Validated NRIC', answer: 'T0000001A', fieldType: 'nric' },
  { _id: 'f4', question: 'Unit & Coy', answer: '40 SAR / Archer', fieldType: 'dropdown' },
  { _id: 'f5', question: 'Report Sick Type', answer: 'Report Sick In (RSI)', fieldType: 'radiobutton' },
  { _id: 'f6', question: 'Report Sick Time', answer: '08:30', fieldType: 'time' },
  { _id: 'f7', question: 'Outcome given by the doctor/MO', answer: 'MC', fieldType: 'radiobutton' },
  { _id: 'f8', question: 'Days given for Sick Leave / MC', answer: '2', fieldType: 'number' },
  { _id: 'f9', question: 'Status Given', answer: 'Excuse RMJ', fieldType: 'dropdown' },
  { _id: 'f10', question: 'Days given for Status', answer: '5', fieldType: 'number' },
];

/** Every row the fake database was asked to insert. */
interface Recorder {
  values: Record<string, unknown>[];
}

/**
 * Builds a fake Drizzle handle that records `insert().values().onConflictDoNothing()`.
 *
 * @param recorder Where to record.
 * @returns The fake handle.
 */
function fakeDb(recorder: Recorder): any {
  return {
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          recorder.values.push(row);
        },
      }),
    }),
  };
}

/**
 * Builds deps with a stub SDK whose decryptors return canned plaintext.
 *
 * @param overrides Behaviour to change for one test.
 * @returns The deps and the recorder.
 */
function deps(
  overrides: {
    authenticate?: () => boolean;
    decrypted?: unknown;
    v3?: unknown;
    secretKey?: string | undefined;
    postUri?: string | undefined;
  } = {},
): { deps: Deps; recorder: Recorder } {
  const recorder: Recorder = { values: [] };
  return {
    recorder,
    deps: {
      db: fakeDb(recorder),
      secretKey: 'secretKey' in overrides ? overrides.secretKey : SECRET_KEY,
      postUri: 'postUri' in overrides ? overrides.postUri : POST_URI,
      sdk: {
        webhooks: {
          authenticate:
            overrides.authenticate ??
            (() => true),
        },
        crypto: {
          decrypt: () =>
            'decrypted' in overrides
              ? overrides.decrypted
              : { responses: RESPONSES, verified: { uinFin: 'T0000001A' } },
        },
        cryptoV3: {
          decrypt: () => ('v3' in overrides ? overrides.v3 : null),
        },
      },
    },
  };
}

/**
 * Builds a webhook request.
 *
 * @param data The payload's `data` object, or a raw string body.
 * @param options Method and signature overrides.
 * @returns The request.
 */
function post(
  data: unknown,
  options: { method?: string; signature?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const signature = options.signature === undefined ? 't=1,s=sig' : options.signature;
  if (signature !== null) headers['X-FormSG-Signature'] = signature;
  return new Request(POST_URI, {
    method: options.method ?? 'POST',
    headers,
    body: typeof data === 'string' ? data : JSON.stringify({ data }),
  });
}

/** A minimal storage-mode payload. */
const V2_DATA = {
  formId: 'form-1',
  submissionId: 'sub-1',
  encryptedContent: 'ciphertext',
  verifiedContent: 'more-ciphertext',
  version: 1,
  created: '2026-09-18T08:31:00.000+08:00',
};

describe('method, configuration and signature', () => {
  test('rejects anything but POST', async () => {
    expect((await handle(post(V2_DATA, { method: 'GET' }), deps().deps)).status).toBe(405);
  });

  test('fails closed when the secret key or post URI is unset', async () => {
    expect((await handle(post(V2_DATA), deps({ secretKey: undefined }).deps)).status).toBe(503);
    expect((await handle(post(V2_DATA), deps({ postUri: undefined }).deps)).status).toBe(503);
  });

  test('refuses an unsigned request', async () => {
    const harness = deps();
    const response = await handle(post(V2_DATA, { signature: null }), harness.deps);
    expect(response.status).toBe(401);
    expect(harness.recorder.values).toEqual([]);
  });

  test('refuses a bad signature, and stores nothing', async () => {
    const harness = deps({
      authenticate: () => {
        throw new Error('Signature could not be verified');
      },
    });
    const response = await handle(post(V2_DATA), harness.deps);
    expect(response.status).toBe(401);
    expect(harness.recorder.values).toEqual([]);
  });

  test('refuses when authenticate returns false instead of throwing', async () => {
    /*
     * Unreachable with the SDK as it stands -- every failure path throws. But the method is
     * typed `=> boolean`, so a check that passes only because the implementation happens to
     * throw would become a no-op accepting every forged webhook the day an upgrade returned
     * `false` instead, with nothing raised anywhere to say so.
     */
    const harness = deps({ authenticate: () => false });
    const response = await handle(post(V2_DATA), harness.deps);
    expect(response.status).toBe(401);
    expect(harness.recorder.values).toEqual([]);
  });

  test('refuses when authenticate returns a non-true truthy value', async () => {
    // A wrapper returning the parsed header object, say. Only `true` is acceptance.
    const harness = deps({ authenticate: (() => ({ ok: 1 })) as unknown as () => boolean });
    expect((await handle(post(V2_DATA), harness.deps)).status).toBe(401);
  });

  test('does not echo the signature failure reason', async () => {
    // It distinguishes a stale timestamp from a wrong URI, which helps an attacker calibrate.
    const harness = deps({
      authenticate: () => {
        throw new Error('epoch is more than 5 minutes old');
      },
    });
    const text = await (await handle(post(V2_DATA), harness.deps)).text();
    expect(text).not.toContain('5 minutes');
  });
});

describe('payload handling', () => {
  test('a malformed body is a 400, so FormSG stops redelivering it', async () => {
    expect((await handle(post('{broken'), deps().deps)).status).toBe(400);
  });

  test('a payload with no data object is a 400', async () => {
    const request = new Request(POST_URI, {
      method: 'POST',
      headers: { 'X-FormSG-Signature': 't=1,s=sig', 'Content-Type': 'application/json' },
      body: JSON.stringify({ notData: true }),
    });
    expect((await handle(request, deps().deps)).status).toBe(400);
  });

  test('an undecryptable payload is a 400, not a 500', async () => {
    /*
     * The distinction is operational: a 5xx tells FormSG to retry, and a submission that
     * cannot be decrypted will fail identically every time.
     */
    const harness = deps({ decrypted: null });
    const response = await handle(post(V2_DATA), harness.deps);
    expect(response.status).toBe(400);
    expect(harness.recorder.values).toEqual([]);
  });

  test('stores a valid submission as one flat row', async () => {
    const harness = deps();
    const response = await handle(post(V2_DATA), harness.deps);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'stored' });
    expect(harness.recorder.values).toHaveLength(1);
    expect(harness.recorder.values[0]).toMatchObject({
      responseId: 'sub-1',
      timestamp: '2026-09-18T08:31:00.000+08:00',
      rank: 'CPL',
      unitCoy: '40 SAR / Archer',
      company: 'Archer',
      reportSickDate: '2026-09-18',
      mcDays: 2,
      status1: 'Excuse RMJ',
      status1Days: 5,
    });
  });
});

describe('the privacy boundary', () => {
  test('NO NRIC REACHES A ROW, from the answers or from verified content', async () => {
    const harness = deps();
    await handle(post(V2_DATA), harness.deps);

    const written = JSON.stringify(harness.recorder.values);
    expect(written).not.toContain('T0000001A');
    expect(written).not.toMatch(/\b[STFGM]\d{7}[A-Z]\b/);
    // The name did survive -- identity is kept, the identifier is not.
    expect(written).toContain('TAN AH KOW');
  });

  test('keeps the normalised name as the identity key', async () => {
    const harness = deps();
    await handle(post(V2_DATA), harness.deps);
    expect(harness.recorder.values[0]!.nameKey).toBeTruthy();
  });

  test('refuses a submission with an NRIC typed into a free-text answer', async () => {
    /*
     * The case the field-name filters cannot catch: a soldier writing their own NRIC into
     * "Reason for Reporting Sick". 422 rather than 500 -- the request was understood, the
     * content is what cannot be stored, and retrying will not change it.
     */
    const harness = deps({
      decrypted: {
        responses: [
          ...RESPONSES,
          {
            _id: 'f11',
            question: 'Reason for Reporting Sick (Keep Brief)',
            answer: 'Fever, my NRIC is T0000001A',
            fieldType: 'textarea',
          },
        ],
      },
    });

    const response = await handle(post(V2_DATA), harness.deps);
    expect(response.status).toBe(422);
    expect(harness.recorder.values).toEqual([]);
  });
});

describe('crypto version dispatch', () => {
  test('uses v3 when the payload carries an encrypted submission key', async () => {
    /*
     * The discriminator is the payload's own shape, not a configured version -- so a form
     * migrated between storage and multi-respondent mode keeps working with no redeploy.
     */
    const harness = deps({
      v3: {
        responses: {
          f2: { fieldType: 'textfield', answer: 'TAN AH KOW' },
          f4: { fieldType: 'dropdown', answer: '40 SAR / Archer' },
        },
      },
      decrypted: null,
    });

    const response = await handle(
      post({ ...V2_DATA, encryptedSubmissionSecretKey: 'wrapped-key', version: 3 }),
      harness.deps,
    );

    // v2 would have returned null and produced a 400; reaching 200 proves v3 was chosen.
    expect(response.status).toBe(200);
  });

  test('a v3 payload maps by field id, which needs FIELD_IDS populated', async () => {
    /*
     * A v3 submission carries NO question text, so title matching is impossible by
     * construction. Until `FIELD_IDS` is harvested from a real submission, every answer is
     * unmapped -- the submission still stores, but nearly empty. This test records that as a
     * known state rather than letting it be discovered in production.
     */
    const harness = deps({
      v3: { responses: { f2: { fieldType: 'textfield', answer: 'TAN AH KOW' } } },
      decrypted: null,
    });

    await handle(
      post({ ...V2_DATA, encryptedSubmissionSecretKey: 'wrapped-key', version: 3 }),
      harness.deps,
    );

    // Absent from the row, so Drizzle inserts NULL.
    expect(harness.recorder.values[0]!.name).toBeUndefined();
  });
});

describe('real FormSG crypto', () => {
  /*
   * The SDK's own `test` mode, whose signing secret the SDK publishes for exactly this. It
   * proves the signature check and decryption work together, not just against stubs.
   */
  const TEST_SIGNING_SECRET =
    '/u+LP57Ib9y5Ytpud56FzuitSC9O6lJ4EOLOFHpsHlYpRjVdPfRqv5et5WOxLXD9zcSkOzagBJsXobd6+9pQkw==';

  /**
   * Builds a genuinely encrypted and signed webhook request.
   *
   * @param uri The URI the signature covers.
   * @returns The request, the form's secret key, and the SDK to verify with.
   */
  function signedRequest(uri: string) {
    const sdk = formsgSdk({ mode: 'test', webhookSecretKey: TEST_SIGNING_SECRET });
    const { publicKey, secretKey } = sdk.crypto.generate();
    const [submissionId, formId, epoch] = ['sub-real', 'form-real', Date.now()];
    const data = {
      formId,
      submissionId,
      encryptedContent: sdk.crypto.encrypt(RESPONSES, publicKey),
      version: 1,
      created: '2026-09-18T23:30:00.000Z',
    };
    const signature = sdk.webhooks.generateSignature({ uri, submissionId, formId, epoch });
    const header = sdk.webhooks.constructHeader({ epoch, submissionId, formId, signature });
    const request = new Request(POST_URI, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-FormSG-Signature': header },
      body: JSON.stringify({ data }),
    });
    return { request, secretKey, sdk };
  }

  test('verifies, decrypts and stores a real payload', async () => {
    const { request, secretKey, sdk } = signedRequest(POST_URI);
    const recorder: Recorder = { values: [] };
    const response = await handle(request, { db: fakeDb(recorder), secretKey, postUri: POST_URI, sdk });

    expect(response.status).toBe(200);
    expect(recorder.values[0]).toMatchObject({ name: 'TAN AH KOW', status1: 'Excuse RMJ' });
    // 23:30 UTC is 07:30 the next morning in Singapore.
    expect(recorder.values[0]!.reportSickDate).toBe('2026-09-19');
    expect(JSON.stringify(recorder.values)).not.toContain('T0000001A');
  });

  test('rejects a real signature made for a different URI', async () => {
    const { request, secretKey, sdk } = signedRequest('https://elsewhere.test/api/formsg');
    const recorder: Recorder = { values: [] };
    const response = await handle(request, { db: fakeDb(recorder), secretKey, postUri: POST_URI, sdk });

    expect(response.status).toBe(401);
    expect(recorder.values).toEqual([]);
  });
});
