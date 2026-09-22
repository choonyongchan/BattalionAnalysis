/**
 * The app's three routes, wired to a test database exactly as each file's `route()` wires them to
 * production -- the real pipeline, the real dashboard read and the real FormSG SDK (in its test
 * mode) -- and optionally served over HTTP on a local port for the end-to-end suite.
 */
import { handle as handleDashboard } from '../../api/dashboard.ts';
import { handle as handleFormsg } from '../../api/formsg.ts';
import { handle as handleParade, type Deps as ParadeDeps } from '../../api/parade.ts';
import type { Db } from '../../db/index.ts';
import { loadTabs } from '../../lib/dashboard.ts';
import {
  deleteMessage,
  editMessage,
  getMessage,
  ingestMessage,
  listMessages,
  type ModelParser,
} from '../../lib/pipeline.ts';
import { FORM_KEYS, POST_URI, testSdk } from './formsg.ts';

/** The dashboard password the tests configure. */
export const DASHBOARD_PASSWORD = 'dashboard-test-password-long-enough';

/** The relay secret the tests configure. */
export const INGEST_SECRET = 'relay-test-secret-long-enough';

/**
 * The parade route's dependencies over a real database, as `api/parade.ts#route` builds them.
 *
 * @param db The database.
 * @param options The clock to stamp arrivals with, and the model fallback.
 * @returns The deps.
 */
export function paradeDeps(db: Db, options: { now?: () => Date; model?: ModelParser | null } = {}): ParadeDeps {
  const now = options.now ?? (() => new Date());
  const model = options.model ?? null;
  return {
    store: {
      ingest: (message) => ingestMessage(db, message, now(), model),
      edit: (id, body) => editMessage(db, id, body, model),
      remove: (id) => deleteMessage(db, id),
      list: () => listMessages(db),
      get: (id) => getMessage(db, id),
    },
    dashboardPassword: DASHBOARD_PASSWORD,
    ingestSecret: INGEST_SECRET,
  };
}

/** A running copy of the app on a local port. */
export interface RunningApp {
  origin: string;
  stop: () => void;
}

/**
 * Serves `/api/parade`, `/api/dashboard` and `/api/formsg` over HTTP on a free local port.
 *
 * @param db The database every route uses.
 * @param options Passed to `paradeDeps`.
 * @returns The origin and a stop function.
 */
export function startApp(db: Db, options: Parameters<typeof paradeDeps>[1] = {}): RunningApp {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/api/parade') return handleParade(request, paradeDeps(db, options));
      if (path === '/api/dashboard') {
        return handleDashboard(request, { loadTabs: () => loadTabs(db), dashboardPassword: DASHBOARD_PASSWORD, hasDatabase: true });
      }
      if (path === '/api/formsg') {
        // The signature covers the registered URI, not the local one, as behind Vercel's proxy.
        return handleFormsg(request, { db, secretKey: FORM_KEYS.secretKey, postUri: POST_URI, sdk: testSdk });
      }
      return new Response('Not found', { status: 404 });
    },
  });
  return { origin: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

/**
 * Points the browser code's same-origin `/api/...` calls at a running app, for the duration of
 * `run`. Only the URL is rewritten: the request reaches the real server and its real answer
 * comes back.
 *
 * @param origin The app's origin.
 * @param run The code that calls `fetch('/api/...')`.
 * @returns Whatever `run` returns.
 */
export async function withOrigin<T>(origin: string, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const rewritten = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    original(typeof input === 'string' && input.startsWith('/') ? origin + input : input, init)) as typeof fetch;
  globalThis.fetch = rewritten;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}
