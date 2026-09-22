/**
 * The report-sick webhook, fed genuinely encrypted and signed payloads from the real SDK
 * (`test/support/formsg.ts`).
 *
 * The privacy assertions are the point of this file. FormSG hands over identity two ways -- as a
 * `SingPass Validated NRIC` answer and as verified content beside the responses -- and neither
 * may reach a row. Status codes are checked deliberately, because FormSG retries a non-2xx: a
 * payload that can never succeed must answer 4xx.
 *
 * Rejections run offline with a database that throws if touched, which proves nothing was
 * written. Stores run against the Neon test branch and are checked by reading the row back.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { handle, type Deps } from '../../api/formsg.ts';
import type { Db } from '../../db/index.ts';
import { reportSickFormsg } from '../../db/schema.ts';
import { countRows, DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';
import { expectedRow, FAKE_NRIC, FORM_KEYS, POST_URI, SICK_SPECS, testSdk, webhookRequest } from '../support/formsg.ts';

/** A database that fails the test if the route tries to use it. */
const UNTOUCHABLE_DB = new Proxy(
  {},
  {
    get() {
      throw new Error('The route touched the database on a request it should have refused.');
    },
  },
);

/**
 * The route's dependencies, configured as production configures them.
 *
 * @param overrides Values to change for one test.
 * @returns The deps.
 */
function deps(overrides: Partial<Deps> = {}): Deps {
  return { db: UNTOUCHABLE_DB, secretKey: FORM_KEYS.secretKey, postUri: POST_URI, sdk: testSdk, ...overrides };
}

/**
 * The real SDK with its signature check replaced, for the two SDK-drift cases no real
 * signature can produce.
 *
 * @param authenticate What `authenticate` returns.
 * @returns The SDK.
 */
function sdkWhoseAuthenticateReturns(authenticate: unknown): Deps['sdk'] {
  return { ...testSdk, webhooks: { authenticate: () => authenticate as boolean } };
}

const SPEC = SICK_SPECS[0]!;

describe('requests that are refused, and write nothing', () => {
  test.each([
    ['a GET', () => new Request(POST_URI, { method: 'GET' }), {}, 405],
    ['no secret key configured', () => webhookRequest(SPEC), { secretKey: undefined }, 503],
    ['no post URI configured', () => webhookRequest(SPEC), { postUri: undefined }, 503],
    ['no signature header', () => webhookRequest(SPEC, { signature: null }), {}, 401],
    ['a signature made for another URI', () => webhookRequest(SPEC, { signedFor: 'https://elsewhere.test/api/formsg' }), {}, 401],
    ['authenticate() returning false', () => webhookRequest(SPEC), { sdk: sdkWhoseAuthenticateReturns(false) }, 401],
    ['authenticate() returning a truthy non-true', () => webhookRequest(SPEC), { sdk: sdkWhoseAuthenticateReturns({ ok: 1 }) }, 401],
    ['a payload encrypted to another form', () => webhookRequest(SPEC), { secretKey: testSdk.crypto.generate().secretKey }, 400],
    ['an NRIC typed into a free-text answer', () => webhookRequest(SPEC, { extra: [{ question: 'Reason for Reporting Sick (Keep Brief)', answer: `Fever, my NRIC is ${FAKE_NRIC}` }] }), {}, 422],
  ] as const)('%s → %d', async (_name, request, overrides, status) => {
    expect((await handle(request(), deps(overrides as Partial<Deps>))).status).toBe(status);
  });

  test.each([
    ['a malformed body', '{broken'],
    ['a body with no data object', JSON.stringify({ notData: true })],
  ])('%s is a 400, so FormSG stops redelivering it', async (_name, body) => {
    const signed = webhookRequest(SPEC);
    const request = new Request(POST_URI, { method: 'POST', headers: signed.headers, body });
    expect((await handle(request, deps())).status).toBe(400);
  });

  test('the response never says why a signature failed', async () => {
    const response = await handle(webhookRequest(SPEC, { signedFor: 'https://elsewhere.test/x' }), deps());
    expect(await response.text()).not.toContain('elsewhere');
  });
});

describe.skipIf(!hasTestDb)('submissions that are stored', () => {
  let db: Db;
  beforeEach(async () => {
    db = await resetTestDb();
  }, DB_TIMEOUT_MS);

  /**
   * Reads one stored submission.
   *
   * @param responseId The FormSG submission id.
   * @returns The row, or undefined.
   */
  async function stored(responseId: string) {
    const [row] = await db.select().from(reportSickFormsg).where(eq(reportSickFormsg.responseId, responseId));
    return row;
  }

  test.each(SICK_SPECS.map((spec) => [spec.submissionId, spec] as const))(
    '%s is stored as one row of what was answered, with no NRIC',
    async (_id, spec) => {
      const response = await handle(webhookRequest(spec), deps({ db }));

      expect(response.status).toBe(200);
      const row = await stored(spec.submissionId);
      expect(row).toMatchObject(expectedRow(spec));
      expect(row!.reportSickTime).toStartWith(spec.time);
      expect(JSON.stringify(row)).not.toContain(FAKE_NRIC);
      expect(JSON.stringify(row)).not.toMatch(/\b[STFGM]\d{7}[A-Z]\b/);
    },
    DB_TIMEOUT_MS,
  );

  test('a redelivered submission is stored once', async () => {
    expect((await handle(webhookRequest(SPEC), deps({ db }))).status).toBe(200);
    expect((await handle(webhookRequest(SPEC), deps({ db }))).status).toBe(200);
    expect(await countRows(db, 'report_sick_formsg')).toBe(1);
  }, DB_TIMEOUT_MS);

  test('a multi-respondent (v3) submission is stored too', async () => {
    expect((await handle(webhookRequest(SPEC, { v3: true }), deps({ db }))).status).toBe(200);
    expect(await stored(SPEC.submissionId)).toBeDefined();
  }, DB_TIMEOUT_MS);

  test('a refused submission leaves the table empty', async () => {
    await handle(webhookRequest(SPEC, { signedFor: 'https://elsewhere.test/x' }), deps({ db }));
    expect(await countRows(db, 'report_sick_formsg')).toBe(0);
  }, DB_TIMEOUT_MS);
});
