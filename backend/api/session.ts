/**
 * The login route, the only place a password is sent: POST `{ password }` sets the session cookie (the
 * settings password also sets the edit cookie); DELETE clears both. No lockout, so passwords must be long.
 */
import { getDb } from '../db/index.ts';
import { methodNotAllowed, noStore, readJson, sameSecret } from '../lib/http.ts';
import { readSettings } from '../lib/settings.ts';
import {
  SESSION_TTL_MS,
  SETTINGS_COOKIE,
  clearSessionCookie,
  editSecret,
  issueSession,
  sessionCookie,
  sessionsConfigured,
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

/** How long a new session should last. */
async function sessionTtl(deps: Deps): Promise<number> {
  if (!deps.sessionTtlMs) return SESSION_TTL_MS;
  try {
    const ttl = await deps.sessionTtlMs();
    return Number.isFinite(ttl) && ttl > 0 ? ttl : SESSION_TTL_MS;
  } catch {
    return SESSION_TTL_MS;
  }
}

/** Routes one request. */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'DELETE') {
    const response = noStore(200, { ok: true });
    response.headers.append('Set-Cookie', clearSessionCookie());
    response.headers.append('Set-Cookie', clearSessionCookie(SETTINGS_COOKIE));
    return response;
  }
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'DELETE']);
  if (!deps.dashboardPassword || !sessionsConfigured()) {
    return noStore(503, { ok: false, error: 'not_configured' });
  }

  const parsed = await readJson<{ password?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const password = typeof parsed.body?.password === 'string' ? parsed.body.password : '';
  const edit = editSecret(deps.dashboardPassword, deps.settingsPassword);
  const canEdit = Boolean(password !== '' && edit && sameSecret(password, edit));
  if (password === '' || (!canEdit && !sameSecret(password, deps.dashboardPassword))) {
    return noStore(401, { ok: false, error: 'unauthorised' });
  }

  const now = (deps.now ?? (() => Date.now()))();
  const ttlMs = await sessionTtl(deps);
  const response = noStore(200, { ok: true, expiresAt: new Date(now + ttlMs).toISOString(), canEdit });
  response.headers.append('Set-Cookie', sessionCookie(issueSession(deps.dashboardPassword, ttlMs, now), ttlMs));
  if (canEdit) {
    response.headers.append('Set-Cookie', sessionCookie(issueSession(edit!, ttlMs, now), ttlMs, SETTINGS_COOKIE));
  }
  return response;
}

/**
 * The Vercel entry point, exported per method: a default export runs as a Node `(req, res)` handler
 * that never sends the returned `Response`, so the request hangs.
 */
function route(request: Request): Promise<Response> {
  const hasDatabase = Boolean(process.env.DASHBOARD_DATABASE_URL);
  return handle(request, {
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    settingsPassword: process.env.SETTINGS_PASSWORD,
    sessionTtlMs: hasDatabase
      ? async () =>
          (await readSettings(getDb('DASHBOARD_DATABASE_URL'))).values.session.ttlHours * 60 * 60 * 1000
      : undefined,
  });
}

export { route as DELETE, route as POST };
