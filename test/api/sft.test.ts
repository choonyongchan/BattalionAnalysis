/**
 * The SFT route: the FormSG webhook, fed genuinely encrypted and signed payloads from the real
 * SDK, and the Deposit page's corrections and deletes.
 *
 * The verify/decrypt/refuse logic is shared with report sick (`lib/formsg/webhook.ts`) and is
 * covered in depth by `reportsick.test.ts`; this file proves the SFT route is wired to its own
 * key, URI and table, and that only the dashboard may list, correct or delete a record.
 * NAMES ARE SYNTHETIC.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { handle, type Deps, type SftStore } from '../../api/sft.ts';
import type { Db } from '../../db/index.ts';
import { sftFormsg } from '../../db/schema.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, issueSession } from '../../lib/session.ts';
import { DASHBOARD_PASSWORD, sftDeps } from '../support/app.ts';
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

/** A record store that fails the test if the route reaches it. */
const UNTOUCHABLE_RECORDS = new Proxy({} as SftStore, {
  get() {
    throw new Error('The route reached the record store on a request it should have refused.');
  },
});

/** 2026-09-20 12:00 SGT: after every spec's date, and the clock sessions are issued against. */
const NOW = Date.parse('2026-09-20T04:00:00.000Z');
const SESSION = issueSession(DASHBOARD_PASSWORD, SESSION_TTL_MS, NOW);

/**
 * The route's dependencies, configured as production configures them.
 *
 * @param overrides Values to change for one test.
 * @returns The deps.
 */
function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    db: UNTOUCHABLE_DB,
    secretKey: SFT_FORM_KEYS.secretKey,
    postUri: SFT_POST_URI,
    sdk: testSdk,
    records: UNTOUCHABLE_RECORDS,
    dashboardPassword: DASHBOARD_PASSWORD,
    now: () => NOW,
    ...overrides,
  };
}

/**
 * Builds a dashboard request to the route.
 *
 * @param method The HTTP method.
 * @param options Token, session cookie, origin, query string and JSON (or raw) body.
 * @returns The request.
 */
function dashboardRequest(
  method: string,
  options: { token?: string; session?: string; origin?: string; query?: string; body?: unknown } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', host: 'example.test' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.session) headers.cookie = `${SESSION_COOKIE}=${options.session}`;
  if (options.origin) headers.origin = options.origin;
  const body = options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  return new Request(SFT_POST_URI + (options.query ?? ''), { method, headers, body });
}

/** A correction a clerk could save: sft-a, moved to Braves, another place and another day. */
const CORRECTION = {
  rank: 'LCP',
  name: 'ECHO  TAN',
  company: 'Braves',
  groupIc: '3SG FOXTROT LIM',
  pesStatus: 'A',
  exercises: 'Run; Push-ups',
  sfabtType: '',
  location: 'Camp Pool',
  submittedAt: '2026-09-17T19:15',
  informedCommander: true,
  windowConfirmed: false,
};

const SPEC = SFT_SPECS[0]!;

describe('requests that are refused, and write nothing', () => {
  test.each([
    ['a PATCH', () => new Request(SFT_POST_URI, { method: 'PATCH' }), {}, 405],
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

describe('dashboard calls that are refused, and touch nothing', () => {
  const put = (options: Parameters<typeof dashboardRequest>[1]) =>
    dashboardRequest('PUT', { query: '?id=sft-a', body: CORRECTION, ...options });

  test.each([
    ['a list with no credentials', () => dashboardRequest('GET'), 401],
    ['a list with a wrong token', () => dashboardRequest('GET', { token: 'guess' }), 401],
    ['the FormSG key as a token', () => dashboardRequest('GET', { token: SFT_FORM_KEYS.secretKey }), 401],
    ['a correction from another site', () => put({ session: SESSION, origin: 'https://evil.test' }), 401],
    ['a correction with a session but no origin', () => put({ session: SESSION }), 401],
    ['a delete from another site', () => dashboardRequest('DELETE', { session: SESSION, origin: 'https://evil.test', query: '?id=sft-a' }), 401],
    ['a correction with no id', () => put({ token: DASHBOARD_PASSWORD, query: '' }), 400],
    ['a correction with a blank id', () => put({ token: DASHBOARD_PASSWORD, query: '?id=%20' }), 400],
    ['a delete with no id', () => dashboardRequest('DELETE', { token: DASHBOARD_PASSWORD }), 400],
    ['malformed JSON', () => put({ token: DASHBOARD_PASSWORD, body: '{broken' }), 400],
    ['a correction with no name', () => put({ token: DASHBOARD_PASSWORD, body: { ...CORRECTION, name: ' ' } }), 422],
    ['a correction naming no known company', () => put({ token: DASHBOARD_PASSWORD, body: { ...CORRECTION, company: 'Scorpion' } }), 422],
    ['a correction dated in the future', () => put({ token: DASHBOARD_PASSWORD, body: { ...CORRECTION, submittedAt: '2026-09-21T08:00' } }), 422],
    ['an NRIC typed into the location', () => put({ token: DASHBOARD_PASSWORD, body: { ...CORRECTION, location: `Pool ${FAKE_NRIC}` } }), 422],
  ] as const)('%s → %d', async (_name, request, status) => {
    expect((await handle(request(), deps())).status).toBe(status);
  });

  test('every dashboard call is refused when DASHBOARD_PASSWORD is unset', async () => {
    const response = await handle(dashboardRequest('GET', { token: DASHBOARD_PASSWORD }), deps({ dashboardPassword: undefined }));
    expect(response.status).toBe(503);
  });

  test('an expired session is refused', async () => {
    const response = await handle(dashboardRequest('GET', { session: SESSION }), deps({ now: () => NOW + SESSION_TTL_MS + 1 }));
    expect(response.status).toBe(401);
  });

  test('a refused correction says which field to fix', async () => {
    const response = await handle(put({ token: DASHBOARD_PASSWORD, body: { ...CORRECTION, company: 'Scorpion' } }), deps());
    expect(((await response.json()) as { errors: unknown }).errors).toEqual({ company: expect.any(String) });
  });

  test('a store failure is a 500 that does not echo personnel text', async () => {
    const failing = { list: () => Promise.reject(new Error('select failed: ECHO TAN')) } as unknown as SftStore;
    const response = await handle(dashboardRequest('GET', { token: DASHBOARD_PASSWORD }), deps({ records: failing }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('ECHO TAN');
  });
});

describe('dashboard calls that reach the store', () => {
  test('a same-origin session may correct, and the store gets the checked columns', async () => {
    let received: unknown;
    const records = {
      update: async (_id: string, edit: unknown) => {
        received = edit;
        return { responseId: 'sft-a' };
      },
    } as unknown as SftStore;
    const request = dashboardRequest('PUT', { session: SESSION, origin: 'https://example.test', query: '?id=sft-a', body: CORRECTION });
    const response = await handle(request, deps({ records }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(received).toMatchObject({ name: 'ECHO  TAN', company: 'Braves', sfabtType: null, timestamp: '2026-09-17T11:15:00.000Z' });
  });
});

describe.skipIf(!hasTestDb)('corrections and deletes, against the database', () => {
  let db: Db;
  beforeEach(async () => {
    db = await resetTestDb();
    for (const spec of SFT_SPECS) expect((await handle(sftWebhookRequest(spec), sftDeps(db))).status).toBe(200);
  }, DB_TIMEOUT_MS);

  /**
   * Calls the route as a script would, with the password as a bearer token.
   *
   * @param method The HTTP method.
   * @param query The query string.
   * @param body The JSON body, if any.
   * @returns The response.
   */
  function call(method: string, query = '', body?: unknown): Promise<Response> {
    return handle(dashboardRequest(method, { token: DASHBOARD_PASSWORD, query, body }), { ...sftDeps(db), now: () => NOW });
  }

  test('the list holds every record, newest first', async () => {
    const { records } = (await (await call('GET')).json()) as { records: Array<{ responseId: string }> };
    expect(records.map((record) => record.responseId)).toEqual(['sft-e', 'sft-d', 'sft-c', 'sft-b', 'sft-a']);
    expect(Object.keys(records[0]!)).not.toContain('nameKey');
  }, DB_TIMEOUT_MS);

  test('a correction rewrites the answers and everything derived from them', async () => {
    expect((await call('PUT', '?id=sft-a', CORRECTION)).status).toBe(200);
    const [row] = await db.select().from(sftFormsg).where(eq(sftFormsg.responseId, 'sft-a'));
    expect(row).toMatchObject({
      rank: 'LCP',
      name: 'ECHO  TAN',
      nameKey: 'ECHO TAN',
      company: 'Braves',
      unitCoy: 'Braves',
      location: 'Camp Pool',
      sfabtType: null,
      windowConfirmed: false,
      sftDate: '2026-09-17',
    });
    expect(Date.parse(row!.timestamp)).toBe(Date.parse('2026-09-17T11:15:00.000Z'));
  }, DB_TIMEOUT_MS);

  test('a correction that keeps the company keeps the answer the soldier gave for it', async () => {
    await call('PUT', '?id=sft-a', { ...CORRECTION, company: 'Archer' });
    const [row] = await db.select().from(sftFormsg).where(eq(sftFormsg.responseId, 'sft-a'));
    expect(row).toMatchObject({ company: 'Archer', unitCoy: '40 SAR / Archer' });
  }, DB_TIMEOUT_MS);

  test('a delete removes the one record', async () => {
    expect((await call('DELETE', '?id=sft-a')).status).toBe(200);
    expect(await countRows(db, 'sft_formsg')).toBe(SFT_SPECS.length - 1);
  }, DB_TIMEOUT_MS);

  test.each([
    ['PUT', CORRECTION],
    ['DELETE', undefined],
  ] as const)('%s of an unknown record is a 404 that changes nothing', async (method, body) => {
    expect((await call(method, '?id=sft-missing', body)).status).toBe(404);
    expect(await countRows(db, 'sft_formsg')).toBe(SFT_SPECS.length);
  }, DB_TIMEOUT_MS);
});
