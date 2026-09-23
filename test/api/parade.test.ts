/**
 * The parade intake route: who may call what, how bodies are checked, and what each answer
 * means for the database.
 *
 * Refusals run offline against a store that fails the test if touched, which proves nothing was
 * read or written. Everything that reaches the store runs the real pipeline against the Neon test
 * branch, and is checked by what the route answers and what the tables then hold.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { handle, type Deps } from '../../api/parade.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, issueSession } from '../../lib/session.ts';
import type { Db } from '../../db/index.ts';
import { DASHBOARD_PASSWORD, INGEST_SECRET, paradeDeps } from '../support/app.ts';
import { countRows, DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';
import { expectedCounts, expectedKey, renderParadeState, type ParadeSpec } from '../support/paradeState.ts';
import { DOUBTFUL_EDITS, LAST_PARADE, SCENARIOS } from '../support/scenarios.ts';

const URL = 'https://example.vercel.app/api/parade';
const SPEC = SCENARIOS[1]!.spec;
const GOOD = renderParadeState(SPEC);
const DOUBTFUL = DOUBTFUL_EDITS[0]!.edit(GOOD);

/** A store that fails the test if the route reaches it. */
const UNTOUCHABLE: Deps = {
  store: new Proxy({} as Deps['store'], {
    get() {
      throw new Error('The route reached the store on a request it should have refused.');
    },
  }),
  dashboardPassword: DASHBOARD_PASSWORD,
  ingestSecret: INGEST_SECRET,
};

/** A session cookie the dashboard would hold, and the clock it was issued against. */
const NOW = Date.UTC(2026, 8, 23, 8, 0, 0);
const SESSION = issueSession(DASHBOARD_PASSWORD, SESSION_TTL_MS, NOW);

/**
 * Builds a request.
 *
 * @param method The HTTP method.
 * @param options Token, session cookie, origin, query string and JSON (or raw) body.
 * @returns The request.
 */
function request(
  method: string,
  options: { token?: string; session?: string; origin?: string; query?: string; body?: unknown } = {}
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.session) headers.cookie = `${SESSION_COOKIE}=${options.session}`;
  if (options.origin) headers.origin = options.origin;
  return new Request(URL + (options.query ?? ''), {
    method,
    headers,
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
}

describe('requests refused before the store', () => {
  const RELAY_POST = { waMessageId: 'wa-1', body: GOOD };

  test.each([
    ['no token', request('GET'), 401],
    ['a wrong token', request('GET', { token: 'guess' }), 401],
    ['a blank token', request('POST', { token: ' ', body: RELAY_POST }), 401],
    ['the relay listing', request('GET', { token: INGEST_SECRET }), 403],
    ['the relay editing', request('PUT', { token: INGEST_SECRET, query: '?id=1', body: { body: GOOD } }), 403],
    ['the relay deleting', request('DELETE', { token: INGEST_SECRET, query: '?id=1' }), 403],
    ['a PATCH', request('PATCH', { token: DASHBOARD_PASSWORD }), 405],
    ['an empty body', request('POST', { token: DASHBOARD_PASSWORD, body: { body: '  ' } }), 400],
    ['a non-string body', request('POST', { token: DASHBOARD_PASSWORD, body: { body: 42 } }), 400],
    ['malformed JSON', request('POST', { token: DASHBOARD_PASSWORD, body: '{broken' }), 400],
    ['an oversized body', request('POST', { token: DASHBOARD_PASSWORD, body: { body: 'x'.repeat(50_001) } }), 413],
    ['a relay POST with no WhatsApp id', request('POST', { token: INGEST_SECRET, body: { body: GOOD } }), 400],
    ['a malformed id', request('GET', { token: DASHBOARD_PASSWORD, query: '?id=abc' }), 400],
    ['a zero id', request('GET', { token: DASHBOARD_PASSWORD, query: '?id=0' }), 400],
    ['a DELETE with no id', request('DELETE', { token: DASHBOARD_PASSWORD }), 400],
    ['a PUT with no id', request('PUT', { token: DASHBOARD_PASSWORD, body: { body: GOOD } }), 400],
  ] as const)('%s → %d', async (_name, incoming, status) => {
    expect((await handle(incoming, UNTOUCHABLE)).status).toBe(status);
  });

  test('every request is refused when neither secret is configured', async () => {
    const unconfigured = { ...UNTOUCHABLE, dashboardPassword: undefined, ingestSecret: undefined };
    expect((await handle(request('GET', { token: DASHBOARD_PASSWORD }), unconfigured)).status).toBe(503);
  });

  test('an unset relay secret does not let the relay in', async () => {
    const noRelay = { ...UNTOUCHABLE, ingestSecret: undefined };
    expect((await handle(request('POST', { token: INGEST_SECRET, body: RELAY_POST }), noRelay)).status).toBe(401);
  });

  test('a 405 names the allowed methods', async () => {
    const response = await handle(request('PATCH', { token: DASHBOARD_PASSWORD }), UNTOUCHABLE);
    expect(response.headers.get('Allow')).toContain('DELETE');
  });

  test.each([
    ['a session from another site', request('DELETE', { session: SESSION, origin: 'https://evil.test', query: '?id=1' })],
    ['a session with no origin at all', request('DELETE', { session: SESSION, query: '?id=1' })],
    ['a session posting from another site', request('POST', { session: SESSION, origin: 'https://evil.test', body: { body: GOOD } })],
  ] as const)('%s cannot write: the cookie alone is not enough', async (_name, incoming) => {
    expect((await handle(incoming, { ...UNTOUCHABLE, now: () => NOW }).then((r) => r.status))).toBe(401);
  });

  test('an expired session is refused, and a rotated password ends one early', async () => {
    const expired = request('GET', { session: SESSION });
    expect((await handle(expired, { ...UNTOUCHABLE, now: () => NOW + SESSION_TTL_MS + 1 })).status).toBe(401);
    const rotated = { ...UNTOUCHABLE, dashboardPassword: 'the-new-password', now: () => NOW };
    expect((await handle(request('GET', { session: SESSION }), rotated)).status).toBe(401);
  });

  test('a store failure is a 500 that does not echo personnel text', async () => {
    const failing: Deps = {
      ...UNTOUCHABLE,
      store: { ...UNTOUCHABLE.store, ingest: async () => Promise.reject(new Error('insert failed: REC ALPHA TAN')) } as Deps['store'],
    };
    const response = await handle(request('POST', { token: DASHBOARD_PASSWORD, body: { body: GOOD } }), failing);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('ALPHA TAN');
  });
});

describe.skipIf(!hasTestDb)('requests that reach the pipeline', () => {
  let db: Db;
  let deps: Deps;
  beforeEach(async () => {
    db = await resetTestDb();
    deps = paradeDeps(db, { now: () => new Date(`${SPEC.date}T00:30:00Z`) });
  }, DB_TIMEOUT_MS);

  /**
   * Sends a request and reads the JSON answer.
   *
   * @param incoming The request.
   * @returns Status, body and headers.
   */
  async function send(incoming: Request) {
    const response = await handle(incoming, deps);
    // Typed loosely: each test asserts the shape it expects.
    return { status: response.status, body: (await response.json()) as any, headers: response.headers };
  }

  /**
   * Relays a message as the WhatsApp bridge does.
   *
   * @param waMessageId The WhatsApp id.
   * @param body The text.
   * @returns The answer.
   */
  function relay(waMessageId: string, body: string) {
    return send(request('POST', { token: INGEST_SECRET, body: { waMessageId, body } }));
  }

  test.each([
    ['a template message', GOOD, 200, 'parsed'],
    ['a doubtful message', DOUBTFUL, 422, 'needs_review'],
    ['a last parade state', renderParadeState(LAST_PARADE), 422, 'rejected'],
  ] as const)('relaying %s answers %d %s', async (_name, text, status, outcome) => {
    const answer = await relay('wa-1', text);
    expect(answer.status).toBe(status);
    expect(answer.body.status).toBe(outcome);
    expect(await countRows(db, 'raw_messages')).toBe(1);
    expect(await countRows(db, 'parade_submissions')).toBe(outcome === 'parsed' ? 1 : 0);
  }, DB_TIMEOUT_MS);

  test('a relayed message writes one row per line, under its key', async () => {
    const answer = await relay('wa-1', GOOD);
    expect(answer.body).toMatchObject({ paradeResponseId: expectedKey(SPEC), counts: expectedCounts(SPEC) });
    expect(await countRows(db, 'personnel_rows', expectedKey(SPEC))).toBe(expectedCounts(SPEC).personnel);
  }, DB_TIMEOUT_MS);

  test('a relay retry of a delivered message is a final 200 that changes nothing', async () => {
    await relay('wa-1', GOOD);
    const retry = await relay('wa-1', GOOD);
    expect(retry).toMatchObject({ status: 200, body: { status: 'already_parsed' } });
    expect(await countRows(db, 'raw_messages')).toBe(1);
  }, DB_TIMEOUT_MS);

  test('the same text deposited twice from the dashboard is one message, whatever id it claims', async () => {
    await send(request('POST', { token: DASHBOARD_PASSWORD, body: { waMessageId: 'spoof', body: GOOD } }));
    const again = await send(request('POST', { token: DASHBOARD_PASSWORD, body: { body: `${GOOD}\n` } }));

    expect(again.body.status).toBe('already_parsed');
    const list = await send(request('GET', { token: DASHBOARD_PASSWORD }));
    expect(list.body.messages).toHaveLength(1);
    expect(list.body.messages[0].waMessageId).toStartWith('manual:');
  }, DB_TIMEOUT_MS);

  test('the list carries no text and is never cached; one message by id carries its text', async () => {
    const { body: posted } = await relay('wa-1', GOOD);
    const list = await send(request('GET', { token: DASHBOARD_PASSWORD }));

    expect(list.headers.get('Cache-Control')).toBe('no-store');
    expect(list.body.messages[0]).not.toHaveProperty('body');
    expect(JSON.stringify(list.body)).not.toContain(SPEC.units[0]!.entries[0]!.name);
    expect((await send(request('GET', { token: DASHBOARD_PASSWORD, query: `?id=${posted.id}` }))).body).toEqual({ id: posted.id, body: GOOD });
    expect((await send(request('GET', { token: DASHBOARD_PASSWORD, query: '?id=999' }))).status).toBe(404);
  }, DB_TIMEOUT_MS);

  test('an edit that parses replaces the rows; one that does not is a 422 and changes nothing', async () => {
    const { body: posted } = await relay('wa-1', GOOD);
    const moved: ParadeSpec = { ...SPEC, date: '2026-09-19' };

    const bad = await send(request('PUT', { token: DASHBOARD_PASSWORD, query: `?id=${posted.id}`, body: { body: DOUBTFUL } }));
    expect(bad.status).toBe(422);
    expect(await countRows(db, 'parade_submissions', expectedKey(SPEC))).toBe(1);

    const good = await send(request('PUT', { token: DASHBOARD_PASSWORD, query: `?id=${posted.id}`, body: { body: renderParadeState(moved) } }));
    expect(good).toMatchObject({ status: 200, body: { paradeResponseId: expectedKey(moved) } });
    expect(await countRows(db, 'parade_submissions', expectedKey(SPEC))).toBe(0);
    expect(await countRows(db, 'parade_submissions', expectedKey(moved))).toBe(1);

    const missing = await send(request('PUT', { token: DASHBOARD_PASSWORD, query: '?id=999', body: { body: GOOD } }));
    expect(missing.status).toBe(404);
  }, DB_TIMEOUT_MS);

  test('a delete removes the message and its rows; a second delete is a 404', async () => {
    const { body: posted } = await relay('wa-1', GOOD);

    expect((await send(request('DELETE', { token: DASHBOARD_PASSWORD, query: `?id=${posted.id}` }))).body).toEqual({ status: 'deleted', id: posted.id });
    expect(await countRows(db, 'raw_messages')).toBe(0);
    expect(await countRows(db, 'personnel_rows')).toBe(0);
    expect((await send(request('DELETE', { token: DASHBOARD_PASSWORD, query: `?id=${posted.id}` }))).status).toBe(404);
  }, DB_TIMEOUT_MS);
});
