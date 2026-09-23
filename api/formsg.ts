/**
 * The FormSG report-sick webhook: verify the signature, decrypt, map, insert.
 *
 * `FORMSG_POST_URI` must byte-match the URL registered in FormSG, because the signature covers it.
 * FormSG retries any non-2xx, so a payload that can never succeed answers 4xx.
 */
import { createRequire } from 'node:module';
import { getDb } from '../db/index.ts';
import { reportSickFormsg } from '../db/schema.ts';
import { json, methodNotAllowed, readJson, serverError } from '../lib/http.ts';
import { DecryptError, decryptSubmission, type WebhookData } from '../lib/formsg/decrypt.ts';
import { mapSubmission } from '../lib/formsg/map.ts';

/** What `handle` needs, injected so tests need neither a key pair nor a database. */
export interface Deps {
  db: any;
  secretKey: string | undefined;
  postUri: string | undefined;
  /** `formsg()` in production; a stub in tests. */
  sdk: {
    webhooks: { authenticate(header: string, uri: string): boolean };
    crypto: any;
    cryptoV3: any;
  };
}

/**
 * Loads the FormSG SDK through CommonJS.
 *
 * `@opengovsg/formsg-sdk@8` points its `import` condition at `dist/esm/index.js` but ships no
 * `"type": "module"` beside it, so Node parses that file as CommonJS and the function dies at
 * module load with `SyntaxError: Cannot use import statement outside a module`. Its `require`
 * condition resolves to `cjs-entry.cjs`, a real `.cjs` file that loads cleanly; the package's
 * `exports` map blocks importing that path directly, so it has to be reached via `require`.
 *
 * Bun loads the ESM build leniently, which is why the tests never saw this.
 *
 * The handle is named `require` on purpose: Vercel traces a function's dependencies statically,
 * and it only recognises `require('<literal>')`. Calling `createRequire(...)(...)` inline reads
 * as dynamic, so the package is left out of the bundle and the function fails at runtime with
 * `Cannot find module '@opengovsg/formsg-sdk'`.
 */
const require = createRequire(import.meta.url);
const formsgSdk = require('@opengovsg/formsg-sdk') as (config: { mode: string }) => Deps['sdk'];

/** Anything shaped like an NRIC or FIN; the same shape `test/repo-hygiene.test.ts` checks. */
const NRIC_SHAPE = /\b[STFGM]\d{7}[A-Z]\b/i;

/**
 * Finds a column holding an NRIC-shaped value, e.g. one typed into the free-text reason.
 *
 * @param row The row about to be inserted.
 * @returns The offending column name, or null when the row is clean.
 */
function nricColumn(row: Record<string, unknown>): string | null {
  const hit = Object.entries(row).find(([, v]) => typeof v === 'string' && NRIC_SHAPE.test(v));
  return hit ? hit[0] : null;
}

/**
 * Checks the `X-FormSG-Signature` header.
 *
 * Only a literal `true` passes: a throw or any other return value is a rejection.
 *
 * @param deps The SDK and the registered post URI.
 * @param signature The header value.
 * @returns Whether the signature is valid.
 */
function isAuthentic(deps: Deps, signature: string): boolean {
  try {
    if (deps.sdk.webhooks.authenticate(signature, deps.postUri!) === true) return true;
    console.error('[api/formsg] signature rejected: authenticate() did not return true.');
  } catch (error) {
    // Logged, not returned: the reason would help an attacker calibrate.
    console.error('[api/formsg] signature rejected:', (error as Error).message);
  }
  return false;
}

/**
 * Verifies, decrypts and stores one submission.
 *
 * @param request The incoming request.
 * @param deps Database handle, secrets and the SDK.
 * @returns 200 when stored or already known; 4xx for payloads that can never succeed; 5xx
 *   for failures worth retrying.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!deps.secretKey) return json(503, { error: 'FORMSG_SECRET_KEY is not configured.' });
  if (!deps.postUri) return json(503, { error: 'FORMSG_POST_URI is not configured.' });

  const signature = request.headers.get('x-formsg-signature');
  if (!signature) return json(401, { error: 'Missing X-FormSG-Signature.' });
  if (!isAuthentic(deps, signature)) return json(401, { error: 'Invalid signature.' });

  const parsed = await readJson<{ data?: WebhookData }>(request);
  if (!parsed.ok) return parsed.response;

  let mapped;
  try {
    // ponytail: decryptSubmission rejects a missing data object as a DecryptError, which becomes a 400.
    mapped = mapSubmission(decryptSubmission(parsed.body?.data!, deps.secretKey, deps.sdk));
  } catch (error) {
    if (!(error instanceof DecryptError)) return serverError(error, 'api/formsg');
    console.error('[api/formsg] could not decrypt:', error.message);
    return json(400, { error: 'Could not decrypt the submission.' });
  }

  // Form edits show up here first: a new question, or a renamed option that now maps to null.
  if (mapped.unmapped.length) console.warn(`[api/formsg] unmapped questions: ${mapped.unmapped.join(' | ')}`);
  if (mapped.unrecognised.length) console.warn(`[api/formsg] unrecognised answers: ${mapped.unrecognised.join(' | ')}`);

  const column = nricColumn(mapped.row);
  if (column) {
    console.error(`[api/formsg] refusing to store: ${column} contains an NRIC-shaped value.`);
    return json(422, { error: 'The submission contains an identifier that cannot be stored.' });
  }

  try {
    await deps.db.insert(reportSickFormsg).values(mapped.row).onConflictDoNothing();
  } catch (error) {
    return serverError(error, 'api/formsg');
  }
  return json(200, { status: 'stored' });
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
    db: getDb(),
    secretKey: process.env.FORMSG_SECRET_KEY,
    postUri: process.env.FORMSG_POST_URI,
    sdk: formsgSdk({ mode: 'production' }),
  });
}

export { route as POST };
