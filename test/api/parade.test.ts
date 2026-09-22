/**
 * The parade intake route: who may call what, how bodies are checked, and how pipeline
 * outcomes map to status codes. The store is a fake; the pipeline has its own tests.
 */
import { describe, expect, test } from 'bun:test';
import { handle, type Deps, type Store } from '../../api/parade.ts';
import type { IngestOutcome } from '../../lib/pipeline.ts';

const PASSWORD = 'dashboard-pw';
const SECRET = 'relay-secret';
const URL = 'https://example.vercel.app/api/parade';

const PARSED: IngestOutcome = {
  status: 'parsed',
  id: 1,
  paradeResponseId: 'Archer_2026-09-18_FPS',
  counts: { strength: 2, personnel: 1, roster: 1, sectionCounts: 6 },
};

/**
 * Builds deps over a store that records its calls.
 *
 * @param overrides Store methods to replace, and secrets to change.
 * @returns The deps and the recorded calls.
 */
function setup(overrides: Partial<Store> & { dashboardPassword?: string; ingestSecret?: string } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const store: Store = {
    ingest: async (message) => (calls.push(['ingest', message]), PARSED),
    edit: async (id, body) => (calls.push(['edit', id, body]), PARSED),
    remove: async (id) => (calls.push(['remove', id]), true),
    list: async () => (calls.push(['list']), [{ id: 1 }]),
    get: async (id) => (calls.push(['get', id]), { id, body: 'TEXT' }),
    ...overrides,
  };
  const deps: Deps = {
    store,
    dashboardPassword: 'dashboardPassword' in overrides ? overrides.dashboardPassword : PASSWORD,
    ingestSecret: 'ingestSecret' in overrides ? overrides.ingestSecret : SECRET,
  };
  return { deps, calls };
}

/**
 * Builds a request.
 *
 * @param method The HTTP method.
 * @param options Token, query string and JSON body.
 * @returns The request.
 */
function request(method: string, options: { token?: string; query?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  return new Request(URL + (options.query ?? ''), {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe('authorisation', () => {
  test('refuses every request when neither secret is configured', async () => {
    const { deps } = setup({ dashboardPassword: undefined, ingestSecret: undefined });
    expect((await handle(request('GET', { token: PASSWORD }), deps)).status).toBe(503);
  });

  test('refuses a missing or wrong token', async () => {
    const { deps, calls } = setup();
    expect((await handle(request('GET'), deps)).status).toBe(401);
    expect((await handle(request('GET', { token: 'guess' }), deps)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test('lets the relay POST but nothing else', async () => {
    const { deps } = setup();
    expect((await handle(request('POST', { token: SECRET, body: { waMessageId: 'wa-1', body: 'TEXT' } }), deps)).status).toBe(200);
    expect((await handle(request('GET', { token: SECRET }), deps)).status).toBe(403);
    expect((await handle(request('DELETE', { token: SECRET, query: '?id=1' }), deps)).status).toBe(403);
  });

  test('an unset relay secret does not open the route to an empty token', async () => {
    const { deps } = setup({ ingestSecret: undefined });
    expect((await handle(request('POST', { token: ' ', body: { waMessageId: 'x', body: 'TEXT' } }), deps)).status).toBe(401);
  });

  test('answers 405 with Allow for other methods', async () => {
    const { deps } = setup();
    const response = await handle(request('PATCH', { token: PASSWORD }), deps);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toContain('DELETE');
  });
});

describe('POST', () => {
  test('passes the relay its own WhatsApp id', async () => {
    const { deps, calls } = setup();
    await handle(request('POST', { token: SECRET, body: { waMessageId: 'wa-9', body: 'TEXT' } }), deps);
    expect(calls[0]).toEqual(['ingest', { waMessageId: 'wa-9', body: 'TEXT' }]);
  });

  test('requires the relay to send a WhatsApp id', async () => {
    const { deps } = setup();
    expect((await handle(request('POST', { token: SECRET, body: { body: 'TEXT' } }), deps)).status).toBe(400);
  });

  test('keys a dashboard deposit on its text, ignoring any id it sends', async () => {
    const { deps, calls } = setup();
    await handle(request('POST', { token: PASSWORD, body: { waMessageId: 'spoof', body: 'TEXT' } }), deps);
    await handle(request('POST', { token: PASSWORD, body: { body: 'TEXT\n' } }), deps);
    const ids = calls.map((call) => (call[1] as { waMessageId: string }).waMessageId);
    expect(ids[0]).toStartWith('manual:');
    expect(ids[1]).toBe(ids[0]);
  });

  test('rejects an empty or oversized body', async () => {
    const { deps } = setup();
    expect((await handle(request('POST', { token: PASSWORD, body: { body: '  ' } }), deps)).status).toBe(400);
    expect((await handle(request('POST', { token: PASSWORD, body: { body: 'x'.repeat(50_001) } }), deps)).status).toBe(413);
  });

  test.each([
    [{ status: 'needs_review', id: 1, problems: ['p'] } as IngestOutcome, 422],
    [{ status: 'rejected', id: 1, reason: 'r' } as IngestOutcome, 422],
    [{ status: 'already_parsed', id: 1, paradeResponseId: 'k' } as IngestOutcome, 200],
  ])('maps %o to %i', async (outcome, status) => {
    const { deps } = setup({ ingest: async () => outcome });
    const response = await handle(request('POST', { token: PASSWORD, body: { body: 'TEXT' } }), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(outcome);
  });

  test('turns a store failure into a 500 that does not echo it', async () => {
    const { deps } = setup({
      ingest: async () => {
        throw new Error('insert failed: REC TAN AH KOW');
      },
    });
    const response = await handle(request('POST', { token: PASSWORD, body: { body: 'TEXT' } }), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('TAN AH KOW');
  });
});

describe('dashboard management', () => {
  test('lists messages, uncached', async () => {
    const { deps } = setup();
    const response = await handle(request('GET', { token: PASSWORD }), deps);
    expect(await response.json()).toEqual({ messages: [{ id: 1 }] });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('reads one message by id, 404 when unknown', async () => {
    const { deps } = setup();
    expect(await (await handle(request('GET', { token: PASSWORD, query: '?id=4' }), deps)).json()).toEqual({ id: 4, body: 'TEXT' });
    const missing = setup({ get: async () => null });
    expect((await handle(request('GET', { token: PASSWORD, query: '?id=4' }), missing.deps)).status).toBe(404);
  });

  test('rejects a malformed id', async () => {
    const { deps } = setup();
    expect((await handle(request('GET', { token: PASSWORD, query: '?id=abc' }), deps)).status).toBe(400);
    expect((await handle(request('DELETE', { token: PASSWORD }), deps)).status).toBe(400);
  });

  test('edits by id', async () => {
    const { deps, calls } = setup();
    const response = await handle(request('PUT', { token: PASSWORD, query: '?id=4', body: { body: 'NEW' } }), deps);
    expect(response.status).toBe(200);
    expect(calls[0]).toEqual(['edit', 4, 'NEW']);
  });

  test('an edit that does not parse is a 422, an unknown id a 404', async () => {
    const bad = setup({ edit: async (id) => ({ status: 'needs_review', id, problems: ['p'] }) });
    expect((await handle(request('PUT', { token: PASSWORD, query: '?id=4', body: { body: 'NEW' } }), bad.deps)).status).toBe(422);
    const gone = setup({ edit: async (id) => ({ status: 'not_found', id }) });
    expect((await handle(request('PUT', { token: PASSWORD, query: '?id=4', body: { body: 'NEW' } }), gone.deps)).status).toBe(404);
  });

  test('deletes by id, 404 when unknown', async () => {
    const { deps, calls } = setup();
    expect((await handle(request('DELETE', { token: PASSWORD, query: '?id=4' }), deps)).status).toBe(200);
    expect(calls[0]).toEqual(['remove', 4]);
    const missing = setup({ remove: async () => false });
    expect((await handle(request('DELETE', { token: PASSWORD, query: '?id=4' }), missing.deps)).status).toBe(404);
  });
});
