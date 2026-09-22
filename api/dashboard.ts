/**
 * The dashboard's read route: every tab it charts, from Neon.
 *
 *   GET    all tabs    dashboard password (`Authorization: Bearer <password>`)
 *
 * Answers `{ ok: true, generatedAt, tabs }`, the shape the Apps Script feed answered, built by
 * `lib/dashboard.ts#loadTabs`. It connects as the read-only `dashboard_read` role
 * (`DASHBOARD_DATABASE_URL`, see `db/grants-dashboard.sql`), so a bug here cannot write, and
 * cannot read a message body.
 */
import { getDb } from '../db/index.ts';
import { loadTabs, type Tabs } from '../lib/dashboard.ts';
import { bearerToken, json, methodNotAllowed, sameSecret, serverError } from '../lib/http.ts';

/** What `handle` needs. */
export interface Deps {
  /** Reads every tab; only called once the password checks out. */
  loadTabs: () => Promise<Tabs>;
  dashboardPassword: string | undefined;
  /** Whether a read-only connection string is configured. */
  hasDatabase: boolean;
  /** The clock, injected so tests can pin `generatedAt`. */
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
  const token = bearerToken(request);
  if (!token || !sameSecret(token, deps.dashboardPassword)) {
    return reply(401, { ok: false, error: 'unauthorised' });
  }
  try {
    const tabs = await deps.loadTabs();
    return reply(200, { ok: true, generatedAt: (deps.now ?? (() => new Date()))().toISOString(), tabs });
  } catch (error) {
    return serverError(error, 'api/dashboard');
  }
}

/**
 * The Vercel entry point.
 *
 * @param request The incoming request.
 * @returns The response.
 */
export default function (request: Request): Promise<Response> {
  return handle(request, {
    loadTabs: () => loadTabs(getDb('DASHBOARD_DATABASE_URL')),
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    hasDatabase: Boolean(process.env.DASHBOARD_DATABASE_URL),
  });
}
