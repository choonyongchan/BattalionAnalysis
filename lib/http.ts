/** Small helpers for the Web-standard `(Request) => Response` routes in `api/`. */

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
