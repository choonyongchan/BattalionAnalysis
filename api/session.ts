/**
 * The dashboard's login route: the one place the password is ever sent.
 *
 *   POST   { password }   → `Set-Cookie` carrying a signed, expiring session
 *   DELETE                → clears it
 *
 * The browser then holds an `HttpOnly` cookie it cannot read instead of the password
 * (`lib/session.ts` explains why). Nothing is stored server-side: the token carries its own
 * expiry and is signed with `DASHBOARD_PASSWORD`, so rotating the password ends every open
 * session on its next request.
 *
 * There is no lockout here, exactly as there is none on the other routes — the defence is
 * the length of the passphrase (`docs/dashboard.md`). The answer to a wrong password is a
 * bare 401 that says nothing about how wrong it was, and the comparison is constant-time.
 */
import { json, methodNotAllowed, readJson, sameSecret } from '../lib/http.ts';
import { SESSION_TTL_MS, clearSessionCookie, issueSession, sessionCookie } from '../lib/session.ts';

/** What `handle` needs. */
export interface Deps {
  dashboardPassword: string | undefined;
  /** The clock, injected so tests hold it. */
  now?: () => number;
}

/** No response here may be cached, and none may be stored by a shared proxy. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Routes one request.
 *
 * Fails closed: with no password configured it refuses every login, including an empty one.
 *
 * @param request The incoming request.
 * @param deps The configured password and the clock.
 * @returns The response.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'DELETE') {
    return json(200, { ok: true }, { ...NO_STORE, 'Set-Cookie': clearSessionCookie() });
  }
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'DELETE']);
  if (!deps.dashboardPassword) {
    return json(503, { ok: false, error: 'not_configured' }, NO_STORE);
  }

  const parsed = await readJson<{ password?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const password = typeof parsed.body?.password === 'string' ? parsed.body.password : '';
  if (password === '' || !sameSecret(password, deps.dashboardPassword)) {
    return json(401, { ok: false, error: 'unauthorised' }, NO_STORE);
  }

  const now = (deps.now ?? (() => Date.now()))();
  const token = issueSession(deps.dashboardPassword, SESSION_TTL_MS, now);
  return json(
    200,
    { ok: true, expiresAt: new Date(now + SESSION_TTL_MS).toISOString() },
    { ...NO_STORE, 'Set-Cookie': sessionCookie(token, SESSION_TTL_MS) }
  );
}

/**
 * The Vercel entry point.
 *
 * Exported per HTTP method, not as `default`: Vercel runs a default-exported function as a
 * Node `(req, res)` handler, which never sends the returned `Response`, so the request hangs.
 *
 * @param request The incoming request.
 * @returns The response.
 */
function route(request: Request): Promise<Response> {
  return handle(request, { dashboardPassword: process.env.DASHBOARD_PASSWORD });
}

export { route as DELETE, route as POST };
