/**
 * The dashboard's read route: every tab it charts, from Neon.
 *
 *   GET    all tabs and the settings in force    a dashboard session cookie, or the password as a bearer token
 *
 * Answers `{ ok: true, generatedAt, tabs, settings }`, the shape the Apps Script feed answered
 * plus the settings in force, built by `lib/dashboard.ts#loadTabs` and `lib/settings.ts#readSettings`.
 * It connects as the read-only `dashboard_read` role (`DASHBOARD_DATABASE_URL`, see
 * `db/grants-dashboard.sql`), so a bug here cannot write, and cannot read a message body.
 */
import { getDb } from '../db/index.ts';
import { loadTabs, type Tabs } from '../lib/dashboard.ts';
import { bearerToken, json, methodNotAllowed, sameSecret, serverError } from '../lib/http.ts';
import { readSettings, type ResolvedSettings } from '../lib/settings.ts';
import { hasSession } from '../lib/session.ts';

/** What `handle` needs. */
export interface Deps {
  /** Reads every tab; only called once the password checks out. */
  loadTabs: () => Promise<Tabs>;
  /** Reads the settings in force; only called once the caller checks out. */
  loadSettings: () => Promise<ResolvedSettings>;
  dashboardPassword: string | undefined;
  /** Whether a read-only connection string is configured. */
  hasDatabase: boolean;
  /** The clock, injected so tests can pin `generatedAt` and a session's expiry. */
  now?: () => Date;
}

/** Every response carries personnel data, so none may be cached. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Builds a JSON response that is never cached.
 *
 * @param status The HTTP status code.
 * @param body Anything JSON-serialisable.
 * @returns The response.
 */
function reply(status: number, body: unknown): Response {
  return json(status, body, NO_STORE);
}

/**
 * Whether the caller may read.
 *
 * Two ways in, one secret behind both. The dashboard sends a session cookie issued by
 * `api/session.ts`, which is what keeps the password out of the page; a script or a test
 * sends the password itself as a bearer token. A read is safe cross-site — it changes
 * nothing and `SameSite=Strict` keeps the cookie at home — so there is no origin check
 * here, unlike the write route.
 *
 * @param request The incoming request.
 * @param deps The configured password and the clock.
 * @returns Whether the request is authorised.
 */
function authorised(request: Request, deps: Deps): boolean {
  const now = (deps.now ?? (() => new Date()))().getTime();
  if (hasSession(request, deps.dashboardPassword, now)) return true;
  const token = bearerToken(request);
  return Boolean(token && deps.dashboardPassword && sameSecret(token, deps.dashboardPassword));
}

/**
 * Routes one request.
 *
 * Fails closed: with no password or no read-only connection configured it refuses everything.
 *
 * @param request The incoming request.
 * @param deps The reader and the configured password.
 * @returns The response.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  if (!deps.dashboardPassword || !deps.hasDatabase) {
    return reply(503, { ok: false, error: 'not_configured' });
  }
  if (!authorised(request, deps)) {
    return reply(401, { ok: false, error: 'unauthorised' });
  }
  try {
    const [tabs, settings] = await Promise.all([deps.loadTabs(), deps.loadSettings()]);
    return reply(200, { ok: true, generatedAt: (deps.now ?? (() => new Date()))().toISOString(), tabs, settings });
  } catch (error) {
    return serverError(error, 'api/dashboard');
  }
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
  const db = () => getDb('DASHBOARD_DATABASE_URL');
  return handle(request, {
    loadTabs: () => loadTabs(db()),
    loadSettings: () => readSettings(db()),
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    hasDatabase: Boolean(process.env.DASHBOARD_DATABASE_URL),
  });
}

export { route as GET };
