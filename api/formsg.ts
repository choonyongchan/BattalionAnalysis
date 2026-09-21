/**
 * The report-sick webhook. Replaces Plumber and the shared-secret check it stood in for.
 *
 * What changes here is not the plumbing but the trust model. Plumber forwarded submissions
 * to an Apps Script endpoint whose only proof of origin was a secret in the request body:
 * anyone who learned it could file a report-sick submission for anyone. FormSG signs every
 * webhook, so `webhooks.authenticate` checks a real signature over the URI, the submission
 * id and a timestamp, and forgery needs FormSG's private key rather than a leaked string.
 *
 * The signature covers the URI, so `FORMSG_POST_URI` must byte-match what is registered in
 * the FormSG editor. It is pinned as a variable rather than derived from `VERCEL_URL`
 * because every preview deployment gets a different hostname, and a derived URI would make
 * previews fail authentication for a reason that looks nothing like the cause.
 *
 * NRIC NEVER REACHES A ROW. Three independent things ensure it: `decrypt.ts` never opens
 * `verifiedContent`, `map.ts` discards the NRIC answer by name, and `db/schema.ts` has no
 * column to put one in. `assertNoNric` below is a fourth, checking the built row at runtime,
 * because the first three are all invisible if they stop working.
 */
import { eq } from 'drizzle-orm';
import formsgSdk from '@opengovsg/formsg-sdk';
import { getDb } from '../db/index.ts';
import { formsgStatuses, formsgSubmissions, symptomCategories } from '../db/schema.ts';
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
 * Anything shaped like an NRIC or FIN.
 *
 * Matches the same shape `test/repo-hygiene.test.ts` looks for, on purpose: one definition of
 * "this must not be here", applied to the repository and to the data.
 */
const NRIC_SHAPE = /\b[STFGM]\d{7}[A-Z]\b/i;

/**
 * Refuses a row carrying something NRIC-shaped in any of its values.
 *
 * This should be unreachable. It exists because the three upstream guarantees are all
 * absences -- a key not passed, a field name not matched, a column not declared -- and an
 * absence that stops holding produces no error, just a row with an NRIC in the free-text
 * `reason` column. A soldier typing their own NRIC into "Reason for reporting sick" would
 * also land here, which is the other reason to check values rather than field names.
 *
 * @param row The submission row about to be inserted.
 * @throws {Error} If any value looks like an NRIC.
 */
function assertNoNric(row: Record<string, unknown>): void {
  for (const [column, value] of Object.entries(row)) {
    if (typeof value === 'string' && NRIC_SHAPE.test(value)) {
      throw new Error(`Refusing to store a submission: ${column} contains an NRIC-shaped value.`);
    }
  }
}

/**
 * Loads the symptom lookup.
 *
 * @param database A database handle.
 * @returns Label to id, for resolving the symptoms answer.
 */
async function symptomLookup(database: any): Promise<Map<string, number>> {
  const rows = await database
    .select({ id: symptomCategories.id, label: symptomCategories.label })
    .from(symptomCategories);
  return new Map(rows.map((row: { id: number; label: string }) => [row.label, row.id]));
}

/**
 * Verifies, decrypts and stores one submission.
 *
 * Status codes are chosen for how FormSG reacts to them: it retries a non-2xx. So a payload
 * that can never succeed -- a bad signature, an undecryptable body -- answers 4xx and is
 * dropped after FormSG's own attempts, while a database outage answers 5xx and is retried,
 * which is what should happen.
 *
 * @param request The incoming request.
 * @param deps Database handle, secrets and the SDK.
 * @returns 200 when stored or already known.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  if (!deps.secretKey) return json(503, { error: 'FORMSG_SECRET_KEY is not configured.' });
  if (!deps.postUri) return json(503, { error: 'FORMSG_POST_URI is not configured.' });

  const signature = request.headers.get('x-formsg-signature');
  if (!signature) return json(401, { error: 'Missing X-FormSG-Signature.' });

  /*
   * BOTH FAILURE CHANNELS ARE HANDLED: a throw, and a falsy return.
   *
   * In v8.0.2 every failure path throws and the only `return` is `return true`, so the
   * second check is unreachable today. It is here because the method is TYPED `=> boolean`,
   * and a check that passes only because the implementation happens to throw is a check
   * resting on an implementation detail rather than on the declared contract. An SDK upgrade
   * that returned `false` instead would turn this into a no-op that accepts every forged
   * webhook, with no error raised anywhere to say so. `authenticate` also arrives through
   * `deps.sdk`, so anything wrapping it is free to return rather than throw.
   *
   * Defaulting `verified` to false is the half that matters: the request is rejected unless
   * something affirmatively says otherwise.
   */
  let verified = false;
  try {
    verified = deps.sdk.webhooks.authenticate(signature, deps.postUri) === true;
  } catch (error) {
    // The reason is logged, not returned: it distinguishes a stale timestamp from a wrong
    // URI, which helps an attacker calibrate.
    console.error('[api/formsg] signature rejected:', (error as Error).message);
    return json(401, { error: 'Invalid signature.' });
  }
  if (!verified) {
    console.error('[api/formsg] signature rejected: authenticate() returned a falsy value.');
    return json(401, { error: 'Invalid signature.' });
  }

  const parsed = await readJson<{ data?: WebhookData }>(request);
  if (!parsed.ok) return parsed.response;
  if (!parsed.body?.data) return json(400, { error: 'The payload has no data object.' });

  let mapped;
  try {
    const decrypted = decryptSubmission(parsed.body.data, deps.secretKey, deps.sdk);
    mapped = mapSubmission(decrypted, await symptomLookup(deps.db));
  } catch (error) {
    if (error instanceof DecryptError) {
      console.error('[api/formsg] could not decrypt:', error.message);
      return json(400, { error: 'Could not decrypt the submission.' });
    }
    return serverError(error, 'api/formsg');
  }

  /*
   * An unmapped answer is a warning, not a failure. The form gains questions without warning
   * -- the entire outcome section appeared on 2026-09-16 -- and refusing a submission whose
   * every stored field is present would lose real data over a question nobody has mapped
   * yet. It is logged by title so the gap is visible the first time it happens.
   */
  if (mapped.unmapped.length > 0) {
    console.warn(`[api/formsg] unmapped questions: ${mapped.unmapped.join(' | ')}`);
  }

  /*
   * The quieter failure, and the one nothing else would report. An answer that matches no
   * known option is discarded and the column goes null -- which is exactly what happens the
   * day an option label is edited in the FormSG editor. Every submission afterwards looks
   * valid and stores nothing for that field, so it has to be said out loud here.
   */
  if (mapped.unrecognised.length > 0) {
    console.warn(`[api/formsg] unrecognised answers: ${mapped.unrecognised.join(' | ')}`);
  }

  try {
    assertNoNric(mapped.submission);
  } catch (error) {
    console.error('[api/formsg]', (error as Error).message);
    return json(422, { error: 'The submission contains an identifier that cannot be stored.' });
  }

  try {
    /*
     * One batch, so a submission and its statuses arrive together or not at all. The
     * statuses are deleted before being inserted because a redelivery must not double them;
     * `on conflict do nothing` on the parent plus a clean child rewrite makes replay exact
     * rather than merely harmless.
     */
    await deps.db.batch([
      deps.db.insert(formsgSubmissions).values(mapped.submission).onConflictDoNothing(),
      deps.db.delete(formsgStatuses).where(eq(formsgStatuses.responseId, mapped.submission.responseId)),
      ...(mapped.statuses.length ? [deps.db.insert(formsgStatuses).values(mapped.statuses)] : []),
    ]);
  } catch (error) {
    return serverError(error, 'api/formsg');
  }

  return json(200, { status: 'stored', statuses: mapped.statuses.length });
}

/**
 * The Vercel entry point.
 *
 * @param request The incoming request.
 * @returns The response.
 */
export default function (request: Request): Promise<Response> {
  return handle(request, {
    db: getDb(),
    secretKey: process.env.FORMSG_SECRET_KEY,
    postUri: process.env.FORMSG_POST_URI,
    sdk: formsgSdk({ mode: 'production' }),
  });
}
