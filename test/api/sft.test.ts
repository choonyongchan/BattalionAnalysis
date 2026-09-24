/**
 * The SFT webhook, fed genuinely encrypted and signed payloads from the real SDK.
 *
 * The verify/decrypt/refuse logic is shared with report sick (`lib/formsg/webhook.ts`) and is
 * covered in depth by `reportsick.test.ts`; this file proves the SFT route is wired to its own
 * key, URI and table. NAMES ARE SYNTHETIC.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { handle, type Deps } from '../../api/sft.ts';
import type { Db } from '../../db/index.ts';
import { sftFormsg } from '../../db/schema.ts';
import { countRows, DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';
import {
  expectedSftRow,
  FAKE_NRIC,
  FORM_KEYS,
  POST_URI,
  SFT_FORM_KEYS,
  SFT_POST_URI,
  SFT_SPECS,
  sftWebhookRequest,
  testSdk,
} from '../support/formsg.ts';

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
  return { db: UNTOUCHABLE_DB, secretKey: SFT_FORM_KEYS.secretKey, postUri: SFT_POST_URI, sdk: testSdk, ...overrides };
}

const SPEC = SFT_SPECS[0]!;

describe('requests that are refused, and write nothing', () => {
  test.each([
    ['a GET', () => new Request(SFT_POST_URI, { method: 'GET' }), {}, 405],
    ['no secret key configured', () => sftWebhookRequest(SPEC), { secretKey: undefined }, 503],
    ['no post URI configured', () => sftWebhookRequest(SPEC), { postUri: undefined }, 503],
    ['no signature header', () => sftWebhookRequest(SPEC, { signature: null }), {}, 401],
    ['a signature for the report-sick URI', () => sftWebhookRequest(SPEC, { signedFor: POST_URI }), {}, 401],
    ['the report-sick form key', () => sftWebhookRequest(SPEC), { secretKey: FORM_KEYS.secretKey }, 400],
    ['an NRIC typed into the location', () => sftWebhookRequest(SPEC, { extra: [{ question: 'Training Location', answer: `Stadium ${FAKE_NRIC}` }] }), {}, 422],
  ] as const)('%s → %d', async (_name, request, overrides, status) => {
    expect((await handle(request(), deps(overrides as Partial<Deps>))).status).toBe(status);
  });

  test('a missing key names the SFT variable', async () => {
    const response = await handle(sftWebhookRequest(SPEC), deps({ secretKey: undefined }));
    expect(await response.text()).toContain('FORMSG_SFT_SECRET_KEY');
  });
});

describe.skipIf(!hasTestDb)('submissions that are stored', () => {
  let db: Db;
  beforeEach(async () => {
    db = await resetTestDb();
  }, DB_TIMEOUT_MS);

  test.each(SFT_SPECS.map((spec) => [spec.submissionId, spec] as const))(
    '%s is stored as one row of what was answered',
    async (_id, spec) => {
      expect((await handle(sftWebhookRequest(spec), deps({ db }))).status).toBe(200);
      const [row] = await db.select().from(sftFormsg).where(eq(sftFormsg.responseId, spec.submissionId));
      expect(row).toMatchObject(expectedSftRow(spec));
    },
    DB_TIMEOUT_MS,
  );

  test('a redelivered submission is stored once', async () => {
    expect((await handle(sftWebhookRequest(SPEC), deps({ db }))).status).toBe(200);
    expect((await handle(sftWebhookRequest(SPEC), deps({ db }))).status).toBe(200);
    expect(await countRows(db, 'sft_formsg')).toBe(1);
  }, DB_TIMEOUT_MS);

  test('a multi-respondent (v3) submission is stored too', async () => {
    expect((await handle(sftWebhookRequest(SPEC, { v3: true }), deps({ db }))).status).toBe(200);
    // v3 carries no question titles, so columns map only once SFT_FIELD_IDS is harvested.
    expect(await countRows(db, 'sft_formsg')).toBe(1);
  }, DB_TIMEOUT_MS);
});
