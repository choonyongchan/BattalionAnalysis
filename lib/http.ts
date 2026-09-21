/**
 * The small amount of HTTP every route repeats.
 *
 * These routes are Web-standard handlers -- `(Request) => Response` -- which is what makes
 * them testable without a mock server: a test constructs a real `Request` and reads a real
 * `Response`. Vercel's Node runtime accepts this signature directly.
 *
 * Three things here exist because Apps Script could not do them, and each was a real weakness
 * rather than an inconvenience:
 *
 *   - **Status codes.** `ContentService` answers 200 to everything, so the bridge had to read
 *     `body.ok` to find out whether its message was stored. A relay that cannot distinguish
 *     "rejected" from "retry me" either loses messages or duplicates them.
 *   - **Request headers.** The shared secret travelled in the JSON body, which meant it was
 *     also in every log line that recorded a request body. Here it is a header.
 *   - **Constant-time comparison.** `a === b` on a secret leaks its length and its matching
 *     prefix through timing. `timingSafeEqual` does not.
 */
import { timingSafeEqual } from 'node:crypto';

/** The JSON content type, written once so a typo cannot make one route answer as text. */
const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * Builds a JSON response.
 *
 * @param status The HTTP status code.
 * @param body Anything JSON-serialisable.
 * @param headers Extra headers to merge in, such as `Retry-After`.
 * @returns The response.
 */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': JSON_TYPE, ...headers },
  });
}

/**
 * Rejects a request whose method the route does not implement.
 *
 * `Allow` is not decoration: it is what makes a 405 actionable to whoever is integrating,
 * and FormSG's own webhook tester reads it.
 *
 * @param allowed The methods this route does implement.
 * @returns A 405 naming them.
 */
export function methodNotAllowed(allowed: string[]): Response {
  return json(405, { error: `Method not allowed. Use ${allowed.join(' or ')}.` }, {
    Allow: allowed.join(', '),
  });
}

/**
 * Compares two secrets without leaking their contents through timing.
 *
 * Length is compared first and separately. That does leak the length of the expected secret,
 * which is unavoidable -- `timingSafeEqual` throws on a length mismatch -- and harmless:
 * knowing a token is 32 characters long does not help anyone guess it.
 *
 * @param a One secret. May be null or undefined when a header was absent.
 * @param b The other.
 * @returns True when both are present, non-empty and equal.
 */
export function secretEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Reads a bearer token from an `Authorization` header.
 *
 * @param request The incoming request.
 * @returns The token, or null when the header is absent or not a bearer.
 */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

/**
 * Checks a request's bearer token against a configured secret.
 *
 * FAILS CLOSED. An unset environment variable denies every request rather than allowing
 * every request, which is the failure mode that matters: a deployment that forgets to set
 * `WHATSAPP_INGEST_TOKEN` should stop accepting parade states, not accept them from anyone.
 * The two cases are told apart in the response so the misconfiguration is diagnosable, but
 * both are refusals.
 *
 * @param request The incoming request.
 * @param expected The configured secret, typically from `process.env`.
 * @param name The variable's name, for the misconfiguration message.
 * @returns Null when authorised, or the response to return.
 */
export function requireBearer(
  request: Request,
  expected: string | undefined,
  name: string,
): Response | null {
  if (!expected) return json(503, { error: `${name} is not configured.` });
  if (!secretEquals(bearerToken(request), expected)) {
    return json(401, { error: 'Unauthorised.' }, { 'WWW-Authenticate': 'Bearer' });
  }
  return null;
}

/** A parsed body, or the response explaining why it could not be parsed. */
export type ParsedBody<T> = { ok: true; body: T } | { ok: false; response: Response };

/**
 * Parses a JSON request body.
 *
 * A malformed body is a 400, not an exception. The distinction matters at the intake routes:
 * an unhandled throw becomes a 500, and a 500 tells the bridge to retry forever a request
 * that will never succeed.
 *
 * @param request The incoming request.
 * @returns The parsed body, or the 400 to return.
 */
export async function readJson<T = unknown>(request: Request): Promise<ParsedBody<T>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: json(400, { error: 'Could not read the request body.' }) };
  }
  if (text.trim() === '') {
    return { ok: false, response: json(400, { error: 'The request body is empty.' }) };
  }
  try {
    return { ok: true, body: JSON.parse(text) as T };
  } catch {
    return { ok: false, response: json(400, { error: 'The request body is not valid JSON.' }) };
  }
}

/**
 * Turns an unexpected throw into a 500 without putting its message on the wire.
 *
 * The message goes to the server log, where an operator can read it; the client gets a
 * reference and nothing else. Parser and database errors quote the input they failed on, and
 * for this application that input is personnel data.
 *
 * @param error Whatever was thrown.
 * @param context A short label naming the route, for the log line.
 * @returns A 500 carrying a reference but no detail.
 */
export function serverError(error: unknown, context: string): Response {
  const reference = Math.random().toString(36).slice(2, 10);
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`[${context}] ${reference}: ${message}`);
  return json(500, { error: 'Internal error.', reference });
}
