/**
 * The Settings page's write route.
 *
 *   PUT    { section, value, version }     save one section
 *   DELETE ?section=<name>&version=<n>     reset one section to its default
 *
 * Only someone who logged in with `SETTINGS_PASSWORD` holds the `settings_session` cookie
 * this checks; the dashboard password alone reads settings (through `/api/dashboard`) but
 * cannot change them. Like the parade intake, a cookie-authorised write must also come from
 * this deployment's own pages.
 *
 * The value is validated with the same code the page ran (`src/model/settings/validate.js`),
 * so a hand-crafted request cannot store what the form would refuse. `version` is the one the
 * page edited: a save from a page opened before someone else's save answers 409 rather than
 * undoing it.
 *
 * Every refusal happens before the store is touched. Nothing here logs a value.
 */
import { getDb } from '../db/index.ts';
import { json, methodNotAllowed, readJson, serverError } from '../lib/http.ts';
import { editSecret, hasSettingsSession, isSameOrigin } from '../lib/session.ts';
import { resetSection, saveSection, type SaveOutcome } from '../lib/settings.ts';
import { isSection } from '../src/model/settings/defaults.js';
import { validateSection } from '../src/model/settings/validate.js';

/** The settings writes, injected so tests need no database. */
export interface SettingsStore {
  save(section: string, value: unknown, version: number): Promise<SaveOutcome>;
  reset(section: string, version: number): Promise<SaveOutcome>;
}

/** What `handle` needs. */
export interface Deps {
  store: SettingsStore;
  dashboardPassword: string | undefined;
  settingsPassword: string | undefined;
  /** The clock, injected so tests hold it. */
  now?: () => number;
}

/** No response here may be cached. */
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
 * Whether a value is a version a caller could have seen: a whole number, 0 or more.
 *
 * @param value The candidate.
 * @returns True when usable.
 */
function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Answers a save or reset outcome.
 *
 * @param outcome What the store did.
 * @param warnings Validation warnings to pass back.
 * @returns The response.
 */
function outcomeResponse(outcome: SaveOutcome, warnings: unknown[] = []): Response {
  if (outcome.status === 'conflict') return reply(409, { ok: false, error: 'conflict' });
  return reply(200, { ok: true, version: outcome.version, warnings });
}

/**
 * Handles PUT: validate, then save.
 *
 * @param request The incoming request.
 * @param deps The store.
 * @returns The response.
 */
async function put(request: Request, deps: Deps): Promise<Response> {
  const parsed = await readJson<{ section?: unknown; value?: unknown; version?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const { section, value, version } = parsed.body ?? {};
  if (typeof section !== 'string' || !isSection(section)) {
    return reply(400, { ok: false, error: 'bad_request', message: 'Unknown settings section.' });
  }
  if (!isVersion(version)) {
    return reply(400, { ok: false, error: 'bad_request', message: 'version must be a whole number, 0 or more.' });
  }
  const checked = validateSection(section, value);
  if (checked.errors.length > 0) {
    return reply(422, { ok: false, error: 'invalid', errors: checked.errors, warnings: checked.warnings });
  }
  return outcomeResponse(await deps.store.save(section, checked.value, version), checked.warnings);
}

/**
 * Handles DELETE: reset one section to its default.
 *
 * @param request The incoming request.
 * @param deps The store.
 * @returns The response.
 */
async function remove(request: Request, deps: Deps): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const section = params.get('section') ?? '';
  const version = params.get('version');
  const parsedVersion = version !== null && /^\d+$/.test(version) ? Number(version) : NaN;
  if (!isSection(section) || !isVersion(parsedVersion)) {
    return reply(400, { ok: false, error: 'bad_request', message: 'section and version are required.' });
  }
  return outcomeResponse(await deps.store.reset(section, parsedVersion));
}

/**
 * Routes one request.
 *
 * Fails closed: with no dashboard password, or no distinct settings password, nobody may edit.
 *
 * @param request The incoming request.
 * @param deps The store and the configured passwords.
 * @returns The response.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'PUT' && request.method !== 'DELETE') return methodNotAllowed(['PUT', 'DELETE']);
  const secret = editSecret(deps.dashboardPassword, deps.settingsPassword);
  if (!deps.dashboardPassword || !secret) return reply(503, { ok: false, error: 'not_configured' });
  const now = (deps.now ?? (() => Date.now()))();
  if (!hasSettingsSession(request, secret, now)) return reply(401, { ok: false, error: 'unauthorised' });
  if (!isSameOrigin(request)) return reply(403, { ok: false, error: 'cross_site' });
  try {
    return request.method === 'PUT' ? await put(request, deps) : await remove(request, deps);
  } catch (error) {
    return serverError(error, 'api/settings');
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
  return handle(request, {
    store: {
      save: (section, value, version) => saveSection(getDb(), section, value, version),
      reset: (section, version) => resetSection(getDb(), section, version),
    },
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    settingsPassword: process.env.SETTINGS_PASSWORD,
  });
}

export { route as DELETE, route as PUT };
