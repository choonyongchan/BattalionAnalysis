/**
 * The parade-state intake and its management API.
 *
 *   POST                 store and parse one message   relay secret or dashboard password
 *   GET                  list stored messages          dashboard password
 *   GET    ?id=<n>       one message's text            dashboard password
 *   PUT    ?id=<n>       replace its text, re-parse    dashboard password
 *   DELETE ?id=<n>       delete it and its rows        dashboard password
 *
 * The dashboard calls with the session cookie `api/session.ts` issued it, so the password
 * never sits in the page. The WhatsApp relay is not a browser and holds no cookie: it sends
 * `Authorization: Bearer <PARADE_INGEST_SECRET>` and may only POST. The password itself is
 * still accepted as a bearer token, which is how a script or a test calls in.
 *
 * A cookie-authorised write must also come from this deployment's own origin. `SameSite=Strict`
 * already keeps the cookie off cross-site requests, but a deposit or a delete is not something
 * to leave resting on one browser setting, so the origin is checked too.
 *
 * Status codes are chosen for the relay, which retries a 5xx and nothing else: a message that
 * parsed, or that never will without a person correcting it, answers 2xx or 4xx.
 */
import { createHash } from 'node:crypto';
import { getDb } from '../db/index.ts';
import { OpenAiParser } from '../lib/parser/llm.ts';
import { bearerToken, json, methodNotAllowed, readJson, sameSecret, serverError } from '../lib/http.ts';
import { hasSession, isSameOrigin } from '../lib/session.ts';
import {
  deleteMessage,
  editMessage,
  getMessage,
  ingestMessage,
  listMessages,
  type IngestOutcome,
} from '../lib/pipeline.ts';

/** The pipeline calls the route makes, injected so tests need no database. */
export interface Store {
  ingest(message: { waMessageId: string; body: string }): Promise<IngestOutcome>;
  edit(id: number, body: string): Promise<IngestOutcome>;
  remove(id: number): Promise<boolean>;
  list(): Promise<unknown[]>;
  get(id: number): Promise<{ id: number; body: string } | null>;
}

/** What `handle` needs. */
export interface Deps {
  store: Store;
  dashboardPassword: string | undefined;
  ingestSecret: string | undefined;
  /** The clock, injected so tests hold a session's expiry. */
  now?: () => number;
}

/** Who a request is from. */
type Caller = 'dashboard' | 'relay';

/** Longer than any real parade state by an order of magnitude; anything bigger is not one. */
const MAX_BODY_CHARS = 50_000;

/** Every response carries personnel data or acts on it, so none may be cached. */
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
 * Identifies the caller: a dashboard session cookie, or a bearer secret.
 *
 * An unset secret matches nothing, so a deployment missing one fails closed for that caller.
 * A session only counts on a request from this deployment's own origin when that request
 * changes something; see the file header.
 *
 * @param request The incoming request.
 * @param deps The configured secrets and the clock.
 * @returns The caller, or null when nothing it carries is accepted.
 */
function callerOf(request: Request, deps: Deps): Caller | null {
  const now = (deps.now ?? (() => Date.now()))();
  if (hasSession(request, deps.dashboardPassword, now)) {
    if (request.method === 'GET' || isSameOrigin(request)) return 'dashboard';
    return null;
  }
  const token = bearerToken(request);
  if (!token) return null;
  if (deps.dashboardPassword && sameSecret(token, deps.dashboardPassword)) return 'dashboard';
  if (deps.ingestSecret && sameSecret(token, deps.ingestSecret)) return 'relay';
  return null;
}

/**
 * Reads the `?id=` query parameter.
 *
 * @param request The incoming request.
 * @returns A positive integer id, null when absent, or NaN when present but malformed.
 */
function idOf(request: Request): number | null {
  const raw = new URL(request.url).searchParams.get('id');
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : NaN;
}

/**
 * The idempotency key for a message typed into the dashboard: its text's hash, so pasting
 * the same parade state twice is one message.
 *
 * @param body The message text.
 * @returns The key.
 */
function manualMessageId(body: string): string {
  return 'manual:' + createHash('sha256').update(body.trim()).digest('hex');
}

/**
 * Reads and checks a `{ body, waMessageId? }` request body.
 *
 * @param request The incoming request.
 * @returns The fields, or the 400 to return.
 */
async function readMessage(
  request: Request,
): Promise<{ ok: true; body: string; waMessageId: unknown } | { ok: false; response: Response }> {
  const parsed = await readJson<{ body?: unknown; waMessageId?: unknown }>(request);
  if (!parsed.ok) return parsed;
  const body = parsed.body?.body;
  if (typeof body !== 'string' || body.trim() === '') {
    return { ok: false, response: reply(400, { error: 'body must be the parade-state text.' }) };
  }
  if (body.length > MAX_BODY_CHARS) {
    return { ok: false, response: reply(413, { error: 'That is too long to be a parade state.' }) };
  }
  return { ok: true, body, waMessageId: parsed.body?.waMessageId };
}

/**
 * Turns a pipeline outcome into a response.
 *
 * @param outcome What the pipeline did.
 * @returns 200 when rows exist, 404 for an unknown id, 422 when a person must correct the text.
 */
function outcomeResponse(outcome: IngestOutcome): Response {
  if (outcome.status === 'parsed' || outcome.status === 'already_parsed') return reply(200, outcome);
  if (outcome.status === 'not_found') return reply(404, { error: 'No such message.' });
  return reply(422, outcome);
}

/**
 * Handles POST: store and parse one message.
 *
 * @param request The incoming request.
 * @param deps The store.
 * @param caller Who sent it.
 * @returns The response.
 */
async function post(request: Request, deps: Deps, caller: Caller): Promise<Response> {
  const message = await readMessage(request);
  if (!message.ok) return message.response;

  let waMessageId: string;
  if (caller === 'dashboard') {
    waMessageId = manualMessageId(message.body);
  } else if (typeof message.waMessageId === 'string' && message.waMessageId.trim() !== '') {
    waMessageId = message.waMessageId.trim();
  } else {
    return reply(400, { error: 'waMessageId is required.' });
  }
  return outcomeResponse(await deps.store.ingest({ waMessageId, body: message.body }));
}

/**
 * Handles the dashboard-only methods.
 *
 * @param request The incoming request.
 * @param deps The store.
 * @returns The response.
 */
async function manage(request: Request, deps: Deps): Promise<Response> {
  const id = idOf(request);
  if (Number.isNaN(id)) return reply(400, { error: 'id must be a positive whole number.' });

  if (request.method === 'GET') {
    if (id === null) return reply(200, { messages: await deps.store.list() });
    const message = await deps.store.get(id);
    return message ? reply(200, message) : reply(404, { error: 'No such message.' });
  }

  if (id === null) return reply(400, { error: 'id is required.' });
  if (request.method === 'DELETE') {
    return (await deps.store.remove(id)) ? reply(200, { status: 'deleted', id }) : reply(404, { error: 'No such message.' });
  }

  const message = await readMessage(request);
  if (!message.ok) return message.response;
  return outcomeResponse(await deps.store.edit(id, message.body));
}

/**
 * Routes one request.
 *
 * @param request The incoming request.
 * @param deps The store and the configured secrets.
 * @returns The response.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) {
    return methodNotAllowed(['GET', 'POST', 'PUT', 'DELETE']);
  }
  if (!deps.dashboardPassword && !deps.ingestSecret) {
    return reply(503, { error: 'Neither DASHBOARD_PASSWORD nor PARADE_INGEST_SECRET is configured.' });
  }

  const caller = callerOf(request, deps);
  if (!caller) return reply(401, { error: 'Not authorised.' });
  if (caller === 'relay' && request.method !== 'POST') return reply(403, { error: 'The relay may only POST.' });

  try {
    return request.method === 'POST' ? await post(request, deps, caller) : await manage(request, deps);
  } catch (error) {
    return serverError(error, 'api/parade');
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
  const db = getDb();
  // Null when OPENAI_API_KEY is unset: doubtful messages then wait for review, as before.
  const model = OpenAiParser.fromEnv();
  return handle(request, {
    store: {
      ingest: (message) => ingestMessage(db, message, new Date(), model),
      edit: (id, body) => editMessage(db, id, body, model),
      remove: (id) => deleteMessage(db, id),
      list: () => listMessages(db),
      get: (id) => getMessage(db, id),
    },
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    ingestSecret: process.env.PARADE_INGEST_SECRET,
  });
}

export { route as DELETE, route as GET, route as POST, route as PUT };
