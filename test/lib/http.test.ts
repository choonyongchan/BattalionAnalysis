/** The shared route helpers. */
import { describe, expect, test } from 'bun:test';
import { json, methodNotAllowed, readJson } from '../../lib/http.ts';

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
});
