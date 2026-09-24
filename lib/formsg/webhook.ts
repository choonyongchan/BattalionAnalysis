/**
 * The FormSG webhook shared by every form: verify the signature, decrypt, map, insert.
 *
 * Each form's route (`api/reportsick.ts`, `api/sft.ts`) supplies its own table, mapper, key and
 * post URI. The post URI must byte-match the URL registered in FormSG, because the signature
 * covers it. FormSG retries any non-2xx, so a payload that can never succeed answers 4xx.
 */
import { json, methodNotAllowed, readJson, serverError } from '../http.ts';
import { DecryptError, decryptSubmission, type WebhookData } from './decrypt.ts';
import type { DecryptedSubmission, MappedSubmission } from './map.ts';
import type { FormSgSdk } from './sdk.ts';

/** What a route needs, injected so tests need neither a key pair nor a database. */
export interface Deps {
  db: any;
  secretKey: string | undefined;
  postUri: string | undefined;
  /** `formsg()` in production; a stub in tests. */
  sdk: FormSgSdk;
}

/** What makes one form's webhook different from another's. */
export interface FormSpec {
  /** The Drizzle table one row is inserted into. */
  table: unknown;
  /** Turns a decrypted submission into that row. */
  map: (decrypted: DecryptedSubmission) => MappedSubmission;
  /** The log prefix, e.g. `api/sft`. */
  tag: string;
  /** Env var names, for the 503 a missing one answers. */
  secretKeyVar: string;
  postUriVar: string;
}

/** Anything shaped like an NRIC or FIN; the same shape `test/repo-hygiene.test.ts` checks. */
const NRIC_SHAPE = /\b[STFGM]\d{7}[A-Z]\b/i;

/**
 * Finds a column holding an NRIC-shaped value, e.g. one typed into a free-text answer.
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
 * @param tag The log prefix.
 * @returns Whether the signature is valid.
 */
function isAuthentic(deps: Deps, signature: string, tag: string): boolean {
  try {
    if (deps.sdk.webhooks.authenticate(signature, deps.postUri!) === true) return true;
    console.error(`[${tag}] signature rejected: authenticate() did not return true.`);
  } catch (error) {
    // Logged, not returned: the reason would help an attacker calibrate.
    console.error(`[${tag}] signature rejected:`, (error as Error).message);
  }
  return false;
}

/**
 * Decrypts and maps a verified body.
 *
 * @param data The webhook's `data` object.
 * @param deps The key and SDK.
 * @param form The form's mapper and log prefix.
 * @returns The mapped submission, or the response to answer with.
 */
function mapBody(data: WebhookData, deps: Deps, form: FormSpec): MappedSubmission | Response {
  try {
    // ponytail: decryptSubmission rejects a missing data object as a DecryptError, which becomes a 400.
    return form.map(decryptSubmission(data, deps.secretKey!, deps.sdk));
  } catch (error) {
    if (!(error instanceof DecryptError)) return serverError(error, form.tag);
    console.error(`[${form.tag}] could not decrypt:`, error.message);
    return json(400, { error: 'Could not decrypt the submission.' });
  }
}

/**
 * Verifies, decrypts and stores one submission.
 *
 * @param request The incoming request.
 * @param deps Database handle, secrets and the SDK.
 * @param form The form being received.
 * @returns 200 when stored or already known; 4xx for payloads that can never succeed; 5xx
 *   for failures worth retrying.
 */
export async function handleWebhook(request: Request, deps: Deps, form: FormSpec): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (!deps.secretKey) return json(503, { error: `${form.secretKeyVar} is not configured.` });
  if (!deps.postUri) return json(503, { error: `${form.postUriVar} is not configured.` });

  const signature = request.headers.get('x-formsg-signature');
  if (!signature) return json(401, { error: 'Missing X-FormSG-Signature.' });
  if (!isAuthentic(deps, signature, form.tag)) return json(401, { error: 'Invalid signature.' });

  const parsed = await readJson<{ data?: WebhookData }>(request);
  if (!parsed.ok) return parsed.response;

  const mapped = mapBody(parsed.body?.data!, deps, form);
  if (mapped instanceof Response) return mapped;

  // Form edits show up here first: a new question, or a renamed option that now maps to null.
  if (mapped.unmapped.length) console.warn(`[${form.tag}] unmapped questions: ${mapped.unmapped.join(' | ')}`);
  if (mapped.unrecognised.length) console.warn(`[${form.tag}] unrecognised answers: ${mapped.unrecognised.join(' | ')}`);

  const column = nricColumn(mapped.row);
  if (column) {
    console.error(`[${form.tag}] refusing to store: ${column} contains an NRIC-shaped value.`);
    return json(422, { error: 'The submission contains an identifier that cannot be stored.' });
  }

  try {
    await deps.db.insert(form.table).values(mapped.row).onConflictDoNothing();
  } catch (error) {
    return serverError(error, form.tag);
  }
  return json(200, { status: 'stored' });
}
