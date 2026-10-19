/**
 * The Settings write route: PUT `{ section, value, version }` saves one section, DELETE
 * `?section=&version=` resets it. Needs the settings session and a same-origin request; the value is
 * validated by the page's own code, and a stale `version` answers 409. Nothing here logs a value.
 */
import { getDb } from '../db/index.ts';
import { methodNotAllowed, noStore, readJson, serverError } from '../lib/http.ts';
import { editSecret, hasSettingsSession, isSameOrigin } from '../lib/session.ts';
import { resetSection, saveSection, type SaveOutcome } from '../lib/settings.ts';
import { isSection } from '../../shared/settings/defaults.ts';
import { validateSection } from '../../shared/settings/validate.ts';

/** The settings writes, injected so tests need no database. */
interface SettingsStore {
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

/** The `settings.version` column is `int4`; anything past this cannot be stored. */
const MAX_VERSION = 2147483647;

/**
 * Whether a value is a version the `int4` column can hold; checked here because an oversized one made
 * Postgres fail, and that failure once reached the log with the query's params.
 */
function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_VERSION;
}

/** Answers a save or reset outcome. */
function outcomeResponse(outcome: SaveOutcome, warnings: unknown[] = []): Response {
  if (outcome.status === 'conflict') return noStore(409, { ok: false, error: 'conflict' });
  return noStore(200, { ok: true, version: outcome.version, warnings });
}

/** Handles PUT: validate, then save. */
async function put(request: Request, deps: Deps): Promise<Response> {
  const parsed = await readJson<{ section?: unknown; value?: unknown; version?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const { section, value, version } = parsed.body ?? {};
  if (typeof section !== 'string' || !isSection(section)) {
    return noStore(400, { ok: false, error: 'bad_request', message: 'Unknown settings section.' });
  }
  if (!isVersion(version)) {
    return noStore(400, {
      ok: false,
      error: 'bad_request',
      message: `version must be a whole number from 0 to ${MAX_VERSION}.`,
    });
  }
  const checked = validateSection(section, value);
  if (checked.errors.length > 0) {
    return noStore(422, { ok: false, error: 'invalid', errors: checked.errors, warnings: checked.warnings });
  }
  return outcomeResponse(await deps.store.save(section, checked.value, version), checked.warnings);
}

/** Handles DELETE: reset one section to its default. */
async function remove(request: Request, deps: Deps): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const section = params.get('section') ?? '';
  const version = params.get('version');
  const parsedVersion = version !== null && /^\d+$/.test(version) ? Number(version) : NaN;
  if (!isSection(section) || !isVersion(parsedVersion)) {
    return noStore(400, { ok: false, error: 'bad_request', message: 'section and version are required.' });
  }
  return outcomeResponse(await deps.store.reset(section, parsedVersion));
}

/** Routes one request. */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'PUT' && request.method !== 'DELETE') return methodNotAllowed(['PUT', 'DELETE']);
  const secret = editSecret(deps.dashboardPassword, deps.settingsPassword);
  if (!deps.dashboardPassword || !secret) return noStore(503, { ok: false, error: 'not_configured' });
  const now = (deps.now ?? (() => Date.now()))();
  if (!hasSettingsSession(request, secret, now)) return noStore(401, { ok: false, error: 'unauthorised' });
  if (!isSameOrigin(request)) return noStore(403, { ok: false, error: 'cross_site' });
  try {
    return request.method === 'PUT' ? await put(request, deps) : await remove(request, deps);
  } catch (error) {
    return serverError(error, 'api/settings');
  }
}

/**
 * The Vercel entry point, exported per method: a default export runs as a Node `(req, res)` handler
 * that never sends the returned `Response`, so the request hangs.
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
