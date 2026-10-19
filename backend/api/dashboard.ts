/**
 * GET `/api/dashboard`: every dataset and the settings in force, for a session cookie or the password as bearer.
 * Connects as the read-only `dashboard_read` role, so a bug here cannot write or read a message body.
 */
import { getDb } from '../db/index.ts';
import { loadDashboard } from '../lib/dashboard.ts';
import type { DashboardData } from '../../shared/dashboard.ts';
import { bearerToken, methodNotAllowed, noStore, sameSecret, serverError } from '../lib/http.ts';
import { readSettings } from '../lib/settings.ts';
import type { ResolvedSettings } from '../../shared/settings/resolve.ts';
import { editSecret, hasSession, hasSettingsSession } from '../lib/session.ts';

/** What `handle` needs. */
export interface Deps {
  /** Reads every dataset; only called once the caller checks out. */
  loadData: () => Promise<DashboardData>;
  /** Reads the settings in force; only called once the caller checks out. */
  loadSettings: () => Promise<ResolvedSettings>;
  dashboardPassword: string | undefined;
  /** The read-write password, for telling the page whether it may edit. */
  settingsPassword?: string | undefined;
  /** Whether a read-only connection string is configured. */
  hasDatabase: boolean;
  /** The clock, injected so tests can pin `generatedAt` and a session's expiry. */
  now?: () => Date;
}

/**
 * Whether the caller may read: a session cookie, or the password as a bearer token. No origin check:
 * a read changes nothing, and `SameSite=Strict` keeps the cookie at home.
 */
function authorised(request: Request, deps: Deps): boolean {
  const now = (deps.now ?? (() => new Date()))().getTime();
  if (hasSession(request, deps.dashboardPassword, now)) return true;
  const token = bearerToken(request);
  return Boolean(token && deps.dashboardPassword && sameSecret(token, deps.dashboardPassword));
}

/** Routes one request. */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  if (!deps.dashboardPassword || !deps.hasDatabase) {
    return noStore(503, { ok: false, error: 'not_configured' });
  }
  if (!authorised(request, deps)) {
    return noStore(401, { ok: false, error: 'unauthorised' });
  }
  const now = (deps.now ?? (() => new Date()))();
  const canEdit = hasSettingsSession(request, editSecret(deps.dashboardPassword, deps.settingsPassword), now.getTime());
  try {
    const [data, settings] = await Promise.all([deps.loadData(), deps.loadSettings()]);
    return noStore(200, { ok: true, generatedAt: now.toISOString(), data, settings, canEdit });
  } catch (error) {
    return serverError(error, 'api/dashboard');
  }
}

/**
 * The Vercel entry point, exported per method: a default export runs as a Node `(req, res)` handler
 * that never sends the returned `Response`, so the request hangs.
 */
function route(request: Request): Promise<Response> {
  const db = () => getDb('DASHBOARD_DATABASE_URL');
  return handle(request, {
    loadData: () => loadDashboard(db()),
    loadSettings: () => readSettings(db()),
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    settingsPassword: process.env.SETTINGS_PASSWORD,
    hasDatabase: Boolean(process.env.DASHBOARD_DATABASE_URL),
  });
}

export { route as GET };
