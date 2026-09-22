/**
 * The dashboard read route: who may read, and what a refusal or failure puts on the wire.
 * The reader is a fake; `lib/dashboard.ts` has its own tests.
 */
import { describe, expect, test } from 'bun:test';
import { handle, type Deps } from '../../api/dashboard.ts';

const PASSWORD = 'dashboard-pw';
const URL = 'https://example.vercel.app/api/dashboard';
const TABS = { 'Strength Data': [['parade_response_id']] };

/**
 * Builds deps over a reader that counts its calls.
 *
 * @param overrides Fields to replace.
 * @returns The deps and a call counter.
 */
function setup(overrides: Partial<Deps> = {}) {
  const calls = { load: 0 };
  const deps: Deps = {
    loadTabs: async () => (calls.load++, TABS),
    dashboardPassword: PASSWORD,
    hasDatabase: true,
    now: () => new Date('2026-09-22T01:00:00Z'),
    ...overrides,
  };
  return { deps, calls };
}

/**
 * Builds a request.
 *
 * @param method The HTTP method.
 * @param token The bearer token, if any.
 * @returns The request.
 */
function request(method = 'GET', token?: string): Request {
  return new Request(URL, { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
}

describe('api/dashboard', () => {
  test('the right password reads every tab, uncached', async () => {
    const { deps } = setup();
    const response = await handle(request('GET', PASSWORD), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true, generatedAt: '2026-09-22T01:00:00.000Z', tabs: TABS });
  });

  test('a wrong or missing password is refused before anything is read', async () => {
    for (const token of ['wrong', undefined]) {
      const { deps, calls } = setup();
      const response = await handle(request('GET', token), deps);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ ok: false, error: 'unauthorised' });
      expect(calls.load).toBe(0);
    }
  });

  test('an unconfigured deployment refuses everyone', async () => {
    for (const overrides of [{ dashboardPassword: undefined }, { dashboardPassword: '' }, { hasDatabase: false }]) {
      const { deps, calls } = setup(overrides);
      const response = await handle(request('GET', PASSWORD), deps);
      expect(response.status).toBe(503);
      expect(calls.load).toBe(0);
    }
  });

  test('only GET is served', async () => {
    const response = await handle(request('POST', PASSWORD), setup().deps);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
  });

  test('a read failure answers 500 without its message', async () => {
    const { deps } = setup({
      loadTabs: async () => {
        throw new Error('column "TEST PERSON" does not exist');
      },
    });
    const original = console.error;
    console.error = () => {};
    try {
      const response = await handle(request('GET', PASSWORD), deps);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).not.toContain('TEST PERSON');
      expect(JSON.parse(text).reference).toBeString();
    } finally {
      console.error = original;
    }
  });
});
