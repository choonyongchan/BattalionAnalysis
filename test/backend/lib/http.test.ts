/** The shared route helpers. */
import { describe, expect, spyOn, test } from 'bun:test';
import { json, methodNotAllowed, readJson, serverError } from '../../../backend/lib/http.ts';
import { DrizzleQueryError } from 'drizzle-orm/errors';

describe('json', () => {
  test('sets the status and a JSON content type', async () => {
    const response = json(202, { status: 'stored' });
    expect(response.status).toBe(202);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'stored' });
  });

  test('merges extra headers', () => {
    expect(json(401, {}, { 'WWW-Authenticate': 'Bearer' }).headers.get('www-authenticate')).toBe(
      'Bearer',
    );
  });
});

describe('methodNotAllowed', () => {
  test('names the allowed methods in the body and the Allow header', async () => {
    const response = methodNotAllowed(['GET', 'POST']);
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, POST');
    expect(((await response.json()) as { error: string }).error).toContain('GET or POST');
  });
});

describe('readJson', () => {
  /**
   * Builds a POST with a raw body.
   *
   * @param body The body text.
   * @returns The request.
   */
  function withBody(body: string): Request {
    return new Request('https://example.test/api', { method: 'POST', body });
  }

  test('parses a valid body', async () => {
    const parsed = await readJson<{ a: number }>(withBody('{"a":1}'));
    expect(parsed.ok && parsed.body.a).toBe(1);
  });

  test('answers 400, not a throw, for malformed JSON', async () => {
    /*
     * The distinction is the point: an unhandled throw is a 500, and a 500 tells the bridge
     * to retry forever a request that can never succeed.
     */
    const parsed = await readJson(withBody('{not json'));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(400);
  });

  test('answers 400 for an empty body', async () => {
    const parsed = await readJson(withBody('   '));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(400);
  });

  test('answers 413 for a body past the cap, before parsing it', async () => {
    const parsed = await readJson(withBody(JSON.stringify({ body: 'x'.repeat(300 * 1024) })));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.response.status).toBe(413);
  });
});

describe('serverError', () => {
  const MARKER = 'TAN AH KOW 3203 S0000000Z';

  /**
   * Runs `serverError` and returns the line it logged.
   *
   * @param error What the route threw.
   * @returns The log line and the response.
   */
  function logged(error: unknown): { line: string; response: Response } {
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = serverError(error, 'api/test');
      return { line: String(log.mock.calls[0]?.[0]), response };
    } finally {
      log.mockRestore();
    }
  }

  test('never logs a failed query’s params, but keeps the driver’s error code', async () => {
    // Drizzle's message is "Failed query: <sql>\nparams: <params>": the params are personnel data.
    const driver = Object.assign(new Error(`password authentication failed: ${MARKER}`), { code: '28P01' });
    const error = new DrizzleQueryError('insert into raw_messages (body) values ($1)', [MARKER], driver);
    expect(error.message).toContain(MARKER);

    const { line, response } = logged(error);
    expect(line).not.toContain(MARKER);
    expect(line).toContain('(28P01)');
    expect(JSON.stringify(await response.json())).not.toContain(MARKER);
  });

  test('keeps the stack of a programming error, which names code rather than input', () => {
    const { line } = logged(new TypeError('cannot read properties of undefined'));
    expect(line).toContain('TypeError: cannot read properties of undefined');
  });
});
