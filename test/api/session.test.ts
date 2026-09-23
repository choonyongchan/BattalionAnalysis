/**
 * The login route: the only place the password is sent, and the only place a session is
 * handed out. The cases that matter are the refusals, and that a refusal never sets a
 * cookie — a session issued to a wrong password would be worse than no check at all.
 */
import { describe, expect, test } from 'bun:test';
import { handle, type Deps } from '../../api/session.ts';
import { SESSION_COOKIE, verifySession } from '../../lib/session.ts';

const PASSWORD = 'a-long-dashboard-password';
const URL = 'https://example.vercel.app/api/session';
const NOW = Date.UTC(2026, 8, 23, 8, 0, 0);

/**
 * Builds deps with the clock held.
 *
 * @param overrides Fields to replace.
 * @returns The deps.
 */
function setup(overrides: Partial<Deps> = {}): Deps {
  return { dashboardPassword: PASSWORD, now: () => NOW, ...overrides };
}

/**
 * Builds a login request.
 *
 * @param body The JSON body, already serialised or an object.
 * @param method The HTTP method.
 * @returns The request.
 */
function login(body: unknown, method = 'POST'): Request {
  return new Request(URL, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/**
 * Reads the session token out of a response's `Set-Cookie`.
 *
 * @param response The response.
 * @returns The token, or ''.
 */
function tokenOf(response: Response): string {
  const header = response.headers.get('set-cookie') ?? '';
  return /dashboard_session=([^;]*)/.exec(header)?.[1] ?? '';
}

describe('api/session', () => {
  test('the right password is answered with a signed session cookie', async () => {
    const response = await handle(login({ password: PASSWORD }), setup());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const header = response.headers.get('set-cookie') ?? '';
    expect(header).toContain(`${SESSION_COOKIE}=`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
    expect(verifySession(PASSWORD, tokenOf(response), NOW)).toBe(true);
  });

  test('the session it issues lasts 12 hours and no longer', async () => {
    const token = tokenOf(await handle(login({ password: PASSWORD }), setup()));
    const twelveHours = 12 * 60 * 60 * 1000;
    expect(verifySession(PASSWORD, token, NOW + twelveHours - 1)).toBe(true);
    expect(verifySession(PASSWORD, token, NOW + twelveHours + 1)).toBe(false);
  });

  test('a wrong password is a bare 401 and sets no cookie', async () => {
    const response = await handle(login({ password: 'wrong' }), setup());
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.json()).toEqual({ ok: false, error: 'unauthorised' });
  });

  test('an empty or missing password is refused, never treated as a match', async () => {
    for (const body of [{ password: '' }, {}, { password: 42 }]) {
      const response = await handle(login(body), setup());
      expect(response.status).toBe(401);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  test('with no password configured it refuses every login, including an empty one', async () => {
    for (const body of [{ password: '' }, { password: PASSWORD }]) {
      const response = await handle(login(body), setup({ dashboardPassword: undefined }));
      expect(response.status).toBe(503);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });

  test('a malformed body is a 400, not a 500', async () => {
    const response = await handle(login('{not json'), setup());
    expect(response.status).toBe(400);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('DELETE clears the cookie, so Lock ends the session at the server', async () => {
    const response = await handle(new Request(URL, { method: 'DELETE' }), setup());
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
  });

  test('a method it does not implement is a 405 naming the ones it does', async () => {
    const response = await handle(new Request(URL, { method: 'GET' }), setup());
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, DELETE');
  });
});
