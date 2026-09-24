/**
 * The dashboard's login route: the one place either password is ever sent.
 *
 *   POST   { password }   → `Set-Cookie` carrying a signed, expiring session; the settings
 *                            password also sets a second cookie that opens editing
 *   DELETE                → clears both
 *
 * The browser then holds an `HttpOnly` cookie it cannot read instead of the password
 * (`lib/session.ts` explains why). Nothing is stored server-side: each token carries its own
 * expiry and is signed with the password it corresponds to, so rotating either password ends
 * every open session of that kind on its next request.
 *
 * There is no lockout here, exactly as there is none on the other routes — the defence is
 * the length of the passphrase (`docs/dashboard.md`). The answer to a wrong password is a
 * bare 401 that says nothing about how wrong it was, and the comparison is constant-time.
 */
import { getDb } from '../db/index.ts';
import { json, methodNotAllowed, readJson, sameSecret } from '../lib/http.ts';
import { readSettings } from '../lib/settings.ts';
import {
  SESSION_TTL_MS,
  SETTINGS_COOKIE,
  clearSessionCookie,
  editSecret,
  issueSession,
  sessionCookie,
} from '../lib/session.ts';

/** What `handle` needs. */
export interface Deps {
  dashboardPassword: string | undefined;
  /** The read-write password; unset (or equal to the dashboard password) means no editing. */
  settingsPassword?: string | undefined;
  /** How long a session lasts, from the Session settings; the default when absent or failing. */
  sessionTtlMs?: () => Promise<number>;
  /** The clock, injected so tests hold it. */
  now?: () => number;
}

/** No response here may be cached, and none may be stored by a shared proxy. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * How long a new session should last.
 *
 * A failed or nonsensical settings read must not stop anyone logging in, so it falls back to
 * the default.
 *
 * @param deps The configured reader.
 * @returns Milliseconds.
 */
async function sessionTtl(deps: Deps): Promise<number> {
  if (!deps.sessionTtlMs) return SESSION_TTL_MS;
  try {
    const ttl = await deps.sessionTtlMs();
    return Number.isFinite(ttl) && ttl > 0 ? ttl : SESSION_TTL_MS;
  } catch {
    return SESSION_TTL_MS;
  }
}

/**
 * Routes one request.
 *
 * Fails closed: with no dashboard password configured it refuses every login, including an
 * empty one, and it never grants editing to a settings password that is unset or equal to the
 * dashboard password.
 *
 * @param request The incoming request.
 * @param deps The configured passwords, TTL source and the clock.
 * @returns The response.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'DELETE') {
    const response = json(200, { ok: true }, NO_STORE);
    response.headers.append('Set-Cookie', clearSessionCookie());
    response.headers.append('Set-Cookie', clearSessionCookie(SETTINGS_COOKIE));
    return response;
  }
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'DELETE']);
  if (!deps.dashboardPassword) {
    return json(503, { ok: false, error: 'not_configured' }, NO_STORE);
  }

  const parsed = await readJson<{ password?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const password = typeof parsed.body?.password === 'string' ? parsed.body.password : '';
  const edit = editSecret(deps.dashboardPassword, deps.settingsPassword);
  const canEdit = Boolean(password !== '' && edit && sameSecret(password, edit));
  if (password === '' || (!canEdit && !sameSecret(password, deps.dashboardPassword))) {
    return json(401, { ok: false, error: 'unauthorised' }, NO_STORE);
  }

  const now = (deps.now ?? (() => Date.now()))();
  const ttlMs = await sessionTtl(deps);
  const response = json(200, { ok: true, expiresAt: new Date(now + ttlMs).toISOString(), canEdit }, NO_STORE);
  response.headers.append('Set-Cookie', sessionCookie(issueSession(deps.dashboardPassword, ttlMs, now), ttlMs));
  if (canEdit) {
    response.headers.append('Set-Cookie', sessionCookie(issueSession(edit!, ttlMs, now), ttlMs, SETTINGS_COOKIE));
  }
  return response;
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
  const hasDatabase = Boolean(process.env.DASHBOARD_DATABASE_URL);
  return handle(request, {
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    settingsPassword: process.env.SETTINGS_PASSWORD,
    sessionTtlMs: hasDatabase
      ? async () =>
          Number((await readSettings(getDb('DASHBOARD_DATABASE_URL'))).values.session!.ttlHours) * 60 * 60 * 1000
      : undefined,
  });
}

export { route as DELETE, route as POST };
