/** Small helpers for the Web-standard `(Request) => Response` routes in `api/`. */
import { createHash, timingSafeEqual } from 'node:crypto';

/** The JSON content type, written once so a typo cannot make one route answer as text. */
const JSON_TYPE = 'application/json; charset=utf-8';

/** Builds a JSON response. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': JSON_TYPE, ...headers },
  });
}

/** A JSON response that is never cached; every route's answer can carry personnel data. */
export function noStore(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return json(status, body, { 'Cache-Control': 'no-store', ...headers });
}

/** Rejects a request whose method the route does not implement. */
export function methodNotAllowed(allowed: string[]): Response {
  return json(405, { error: `Method not allowed. Use ${allowed.join(' or ')}.` }, {
    Allow: allowed.join(', '),
  });
}

/**
 * The largest JSON body any route reads. A parade state is capped at 50,000 characters and
 * a FormSG webhook is a few kilobytes; this leaves room for both and refuses anything that
 * could only be an attempt to make a function chew memory.
 */
const MAX_BODY_CHARS = 256 * 1024;

/** A parsed body, or the response explaining why it could not be parsed. */
type ParsedBody<T> = { ok: true; body: T } | { ok: false; response: Response };

/** Parses a JSON request body; a malformed one is a 400, since a 500 would make the relay retry forever. */
export async function readJson<T = unknown>(request: Request): Promise<ParsedBody<T>> {
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, response: json(400, { error: 'Could not read the request body.' }) };
  }
  if (text.length > MAX_BODY_CHARS) {
    return { ok: false, response: json(413, { error: 'The request body is too large.' }) };
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

/** Turns an unexpected throw into a 500 without putting its message on the wire. */
export function serverError(error: unknown, context: string): Response {
  const reference = Math.random().toString(36).slice(2, 10);
  console.error(`[${context}] ${reference}: ${describeError(error)}`);
  return json(500, { error: 'Internal error.', reference });
}

/** Programming errors: their stack names code, never input, so it is safe to log whole. */
const CODE_ERRORS = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError']);

/**
 * Renders one thrown value without text that could quote personnel data (a Drizzle error's message
 * carries the query's params): a programming error keeps its stack, anything else only its name and code.
 */
function describeOne(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  if (CODE_ERRORS.has(error.name)) return error.stack || error.name;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? `${error.name} (${code})` : error.name;
}

/** Renders a thrown value for the log, followed by its `cause` chain. */
function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== undefined; depth++) {
    parts.push(describeOne(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return parts.join(' <- ');
}

/** Compares two secrets in constant time, whatever their lengths. */
export function sameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** Reads the token from an `Authorization: Bearer <token>` header. */
export function bearerToken(request: Request): string | null {
  return /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1] ?? null;
}
