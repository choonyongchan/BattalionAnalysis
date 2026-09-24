/**
 * The settings write route. The refusals matter most, and every refusal must happen before
 * the store is touched: the fake store throws if it is called when it should not be.
 */
import { describe, expect, test } from 'bun:test';
import { handle, type Deps } from '../../api/settings.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, SETTINGS_COOKIE, issueSession } from '../../lib/session.ts';

const READ = 'read-only-password-long';
const WRITE = 'read-write-password-long';
const URL = 'https://example.vercel.app/api/settings';
const NOW = Date.UTC(2026, 8, 24, 2, 0, 0);
const UNIT = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };

/**
 * Deps over a store that records calls, or throws when `untouchable`.
 *
 * @param overrides Fields to replace.
 * @param untouchable Whether any store call should fail the test.
 * @returns The deps and the recorded calls.
 */
function setup(overrides: Partial<Deps> = {}, untouchable = false) {
  const calls: unknown[][] = [];
  const touch = (name: string, ...args: unknown[]) => {
    if (untouchable) throw new Error(`store.${name} must not be called`);
    calls.push([name, ...args]);
  };
  const deps: Deps = {
    store: {
      save: async (...args) => (touch('save', ...args), { status: 'saved', version: 4 }),
      reset: async (...args) => (touch('reset', ...args), { status: 'saved', version: 0 }),
    },
    dashboardPassword: READ,
    settingsPassword: WRITE,
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls };
}

/**
 * A request from the dashboard's own page, carrying the given cookies.
 *
 * @param method The HTTP method.
 * @param options The query string, JSON body, cookies, and fetch-site header.
 * @returns The request.
 */
function request(
  method: string,
  options: { query?: string; body?: unknown; edit?: boolean; read?: boolean; site?: string } = {},
): Request {
  const cookies = [];
  if (options.read !== false) cookies.push(`${SESSION_COOKIE}=${issueSession(READ, SESSION_TTL_MS, NOW)}`);
  if (options.edit !== false) cookies.push(`${SETTINGS_COOKIE}=${issueSession(WRITE, SESSION_TTL_MS, NOW)}`);
  return new Request(URL + (options.query ?? ''), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': options.site ?? 'same-origin',
      cookie: cookies.join('; '),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe('api/settings refusals, all before the store', () => {
  test('a read-only session cannot save', async () => {
    const { deps } = setup({}, true);
    const response = await handle(request('PUT', { edit: false, body: { section: 'unit', value: UNIT, version: 0 } }), deps);
    expect(response.status).toBe(401);
  });

  test('a cross-site request is refused even with both cookies', async () => {
    const { deps } = setup({}, true);
    const response = await handle(request('PUT', { site: 'cross-site', body: { section: 'unit', value: UNIT, version: 0 } }), deps);
    expect(response.status).toBe(403);
  });

  test('no settings password, or one equal to the dashboard password, means no editing at all', async () => {
    for (const settingsPassword of [undefined, READ]) {
      const { deps } = setup({ settingsPassword }, true);
      const response = await handle(request('PUT', { body: { section: 'unit', value: UNIT, version: 0 } }), deps);
      expect(response.status).toBe(503);
    }
  });

  test('an unknown section, a bad version, or a malformed body is a 400', async () => {
    const { deps } = setup({}, true);
    for (const body of [
      { section: 'nope', value: {}, version: 0 },
      { section: 'unit', value: UNIT, version: -1 },
      { section: 'unit', value: UNIT, version: 1.5 },
      { section: 'unit', value: UNIT },
    ]) {
      expect((await handle(request('PUT', { body }), deps)).status).toBe(400);
    }
  });

  test('an invalid value is a 422 carrying field errors', async () => {
    const { deps } = setup({}, true);
    const response = await handle(request('PUT', { body: { section: 'unit', value: { ...UNIT, name: '' }, version: 0 } }), deps);
    expect(response.status).toBe(422);
    const body = (await response.json()) as { errors: Array<{ path: string }> };
    expect(body.errors.map((e: { path: string }) => e.path)).toContain('name');
  });

  test('a method it does not implement is a 405', async () => {
    const { deps } = setup({}, true);
    expect((await handle(request('GET'), deps)).status).toBe(405);
  });

  test('a version past int4 range is a 400, for PUT and DELETE, store untouched', async () => {
    const { deps: putDeps } = setup({}, true);
    const putResponse = await handle(
      request('PUT', { body: { section: 'unit', value: UNIT, version: 2147483648 } }),
      putDeps,
    );
    expect(putResponse.status).toBe(400);

    const { deps: deleteDeps } = setup({}, true);
    const deleteResponse = await handle(request('DELETE', { query: '?section=unit&version=2147483648' }), deleteDeps);
    expect(deleteResponse.status).toBe(400);
  });

  test('a store failure never logs the value it was saving', async () => {
    const marker = 'SECRET-VALUE-MARKER';
    const deps: Deps = {
      store: {
        save: async () => {
          throw new Error(`Failed query: insert into settings ...\nparams: ${marker}`);
        },
        reset: async () => {
          throw new Error('should not be called');
        },
      },
      dashboardPassword: READ,
      settingsPassword: WRITE,
      now: () => NOW,
    };
    const logged: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    };
    try {
      const response = await handle(request('PUT', { body: { section: 'unit', value: UNIT, version: 0 } }), deps);
      expect(response.status).toBe(500);
    } finally {
      console.error = original;
    }
    expect(logged.join('\n')).not.toContain(marker);
  });
});

describe('api/settings writes', () => {
  test('a valid save stores the cleaned value and answers the new version', async () => {
    const { deps, calls } = setup();
    const response = await handle(request('PUT', { body: { section: 'unit', value: { ...UNIT, name: ' 41 SAR ' }, version: 3 } }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: 4, warnings: [] });
    expect(calls).toEqual([['save', 'unit', UNIT, 3]]);
  });

  test('a stale version is a 409', async () => {
    const { deps } = setup({ store: { save: async () => ({ status: 'conflict' }), reset: async () => ({ status: 'conflict' }) } });
    const response = await handle(request('PUT', { body: { section: 'unit', value: UNIT, version: 1 } }), deps);
    expect(response.status).toBe(409);
  });

  test('DELETE resets a section to its default', async () => {
    const { deps, calls } = setup();
    const response = await handle(request('DELETE', { query: '?section=unit&version=2' }), deps);
    expect(response.status).toBe(200);
    expect(calls).toEqual([['reset', 'unit', 2]]);
  });

  test('DELETE without a known section or a version is a 400', async () => {
    const { deps } = setup({}, true);
    expect((await handle(request('DELETE', { query: '?section=unit' }), deps)).status).toBe(400);
    expect((await handle(request('DELETE', { query: '?section=nope&version=1' }), deps)).status).toBe(400);
  });
});
