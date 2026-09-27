/**
 * The FormSG Self-Regulated Fitness Training webhook, and the Deposit page's corrections.
 *
 *   POST                 store one FormSG submission     FormSG signature
 *   GET                  list every SFT record           dashboard password
 *   PUT    ?id=<id>      correct one record's answers    dashboard password
 *   DELETE ?id=<id>      delete one record               dashboard password
 *
 * The verify → decrypt → map → insert flow is `lib/formsg/webhook.ts`, shared with
 * `api/reportsick.ts`. SFT is its own form with its own key; `FORMSG_SFT_POST_URI` must
 * byte-match the URL registered in FormSG (`…/api/sft`). FormSG is the only way a record is
 * created: the dashboard may correct or delete one, never add one. Its calls are authorised
 * as `api/parade.ts` authorises them (`lib/session.ts#isDashboardCaller`).
 */
import { getDb } from '../db/index.ts';
import { sftFormsg } from '../db/schema.ts';
import { formsgSdk } from '../lib/formsg/sdk.ts';
import { mapSftSubmission } from '../lib/formsg/sft.ts';
import { handleWebhook, nricColumn, type Deps as WebhookDeps, type FormSpec } from '../lib/formsg/webhook.ts';
import { json, methodNotAllowed, readJson, serverError } from '../lib/http.ts';
import { isDashboardCaller } from '../lib/session.ts';
import { deleteSftRecord, listSftRecords, updateSftRecord, type SftEdit } from '../lib/sft.ts';
import { validateSftEdit } from '../src/model/sftEdit.js';

/** The record calls the dashboard makes, injected so tests need no database. */
export interface SftStore {
  list(): Promise<unknown[]>;
  update(id: string, edit: SftEdit): Promise<unknown | null>;
  remove(id: string): Promise<boolean>;
}

/** What `handle` needs: the webhook's dependencies, plus the dashboard's. */
export interface Deps extends WebhookDeps {
  records: SftStore;
  dashboardPassword: string | undefined;
  /** The clock, injected so tests hold a session's expiry and "now". */
  now?: () => number;
}

/** The SFT form. */
const FORM: FormSpec = {
  table: sftFormsg,
  map: mapSftSubmission,
  tag: 'api/sft',
  secretKeyVar: 'FORMSG_SFT_SECRET_KEY',
  postUriVar: 'FORMSG_SFT_POST_URI',
};

/** Every method the route answers. */
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];

/** Longer than any FormSG submission id; anything bigger is not one. */
const MAX_ID_CHARS = 100;

/** Every dashboard response carries personnel data or acts on it, so none may be cached. */
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
 * Reads the `?id=` query parameter, a FormSG submission id.
 *
 * @param request The incoming request.
 * @returns The trimmed id, or null when absent, blank or too long.
 */
function idOf(request: Request): string | null {
  const id = new URL(request.url).searchParams.get('id')?.trim();
  return id && id.length <= MAX_ID_CHARS ? id : null;
}

/**
 * Handles PUT: check a correction as the page did, then write it.
 *
 * @param request The incoming request.
 * @param deps The store and the clock.
 * @param id The record's id.
 * @returns 200 with the corrected record, 404, or 422 with what to fix.
 */
async function correct(request: Request, deps: Deps, id: string): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return parsed.response;
  const checked = validateSftEdit(parsed.body, (deps.now ?? Date.now)());
  if (!checked.ok) return reply(422, { error: 'Correct the marked fields.', errors: checked.errors });
  const column = nricColumn(checked.value);
  if (column) return reply(422, { error: 'An identifier cannot be stored.', errors: { [column]: 'Remove the NRIC.' } });
  const record = await deps.records.update(id, checked.value as SftEdit);
  return record ? reply(200, { status: 'updated', record }) : reply(404, { error: 'No such SFT record.' });
}

/**
 * Handles the dashboard's methods.
 *
 * @param request The incoming request.
 * @param deps The store, the password and the clock.
 * @returns The response.
 */
async function manage(request: Request, deps: Deps): Promise<Response> {
  if (!deps.dashboardPassword) return reply(503, { error: 'DASHBOARD_PASSWORD is not configured.' });
  if (!isDashboardCaller(request, deps.dashboardPassword, (deps.now ?? Date.now)())) {
    return reply(401, { error: 'Not authorised.' });
  }
  try {
    if (request.method === 'GET') return reply(200, { records: await deps.records.list() });
    const id = idOf(request);
    if (!id) return reply(400, { error: 'id is required.' });
    if (request.method === 'PUT') return await correct(request, deps, id);
    return (await deps.records.remove(id)) ? reply(200, { status: 'deleted', id }) : reply(404, { error: 'No such SFT record.' });
  } catch (error) {
    return serverError(error, 'api/sft');
  }
}

/**
 * Routes one request: FormSG's POST, or one of the dashboard's calls.
 *
 * @param request The incoming request.
 * @param deps Database handle, secrets, the SDK and the record store.
 * @returns The response.
 */
export function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'POST') return handleWebhook(request, deps, FORM);
  if (!METHODS.includes(request.method)) return Promise.resolve(methodNotAllowed(METHODS));
  return manage(request, deps);
}

/**
 * The Vercel entry point, exported per method (see `api/reportsick.ts`).
 *
 * @param request The incoming request.
 * @returns The response.
 */
function route(request: Request): Promise<Response> {
  const db = getDb();
  return handle(request, {
    db,
    secretKey: process.env.FORMSG_SFT_SECRET_KEY,
    postUri: process.env.FORMSG_SFT_POST_URI,
    sdk: formsgSdk({ mode: 'production' }),
    records: {
      list: () => listSftRecords(db),
      update: (id, edit) => updateSftRecord(db, id, edit),
      remove: (id) => deleteSftRecord(db, id),
    },
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
  });
}

export { route as DELETE, route as GET, route as POST, route as PUT };
