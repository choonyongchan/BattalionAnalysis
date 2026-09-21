/**
 * The shared route helpers.
 *
 * `secretEquals` and `requireBearer` are the two worth testing hardest. Both fail closed, and
 * a helper that fails *open* when misconfigured would hand the parade-state intake to anyone
 * who found the URL -- with no error anywhere to say so.
 */
import { describe, expect, test } from 'bun:test';
import {
  bearerToken,
  json,
  methodNotAllowed,
  readJson,
  requireBearer,
  secretEquals,
} from '../../lib/http.ts';

/**
 * Builds a request with an `Authorization` header.
 *
 * @param header The header value, or undefined to omit it.
 * @returns The request.
 */
function withAuth(header?: string): Request {
  return new Request('https://example.test/api/whatsapp', {
    method: 'POST',
    headers: header === undefined ? {} : { Authorization: header },
  });
}

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

describe('secretEquals', () => {
  test('accepts an exact match', () => {
    expect(secretEquals('s3cret-token', 's3cret-token')).toBe(true);
  });

  test('rejects a mismatch of the same length', () => {
    // Same length, so the comparison reaches timingSafeEqual rather than short-circuiting.
    expect(secretEquals('aaaaaaaaaaaa', 'aaaaaaaaaaab')).toBe(false);
  });

  test('rejects a differing length without throwing', () => {
    // timingSafeEqual throws on unequal buffer lengths; the guard must come first.
    expect(secretEquals('short', 'a-much-longer-secret')).toBe(false);
  });

  test('rejects when either side is absent or empty', () => {
    expect(secretEquals(null, 'token')).toBe(false);
    expect(secretEquals('token', undefined)).toBe(false);
    expect(secretEquals('', '')).toBe(false);
  });
});

describe('bearerToken', () => {
  test('reads a bearer token', () => {
    expect(bearerToken(withAuth('Bearer abc123'))).toBe('abc123');
  });

  test('is case-insensitive about the scheme and tolerates extra whitespace', () => {
    expect(bearerToken(withAuth('  bearer   abc123  '))).toBe('abc123');
  });

  test('returns null for a missing or non-bearer header', () => {
    expect(bearerToken(withAuth())).toBeNull();
    expect(bearerToken(withAuth('Basic dXNlcjpwYXNz'))).toBeNull();
  });
});

describe('requireBearer', () => {
  test('passes a correct token', () => {
    expect(requireBearer(withAuth('Bearer right'), 'right', 'TOKEN')).toBeNull();
  });

  test('rejects a wrong token with 401', () => {
    const response = requireBearer(withAuth('Bearer wrong'), 'right', 'TOKEN')!;
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('FAILS CLOSED when the secret is unset', () => {
    /*
     * The case that matters. A deployment missing WHATSAPP_INGEST_TOKEN must refuse every
     * request, not accept every request -- and a bearer-less request must not slip through
     * by matching an undefined expectation.
     */
    expect(requireBearer(withAuth('Bearer anything'), undefined, 'TOKEN')!.status).toBe(503);
    expect(requireBearer(withAuth(), undefined, 'TOKEN')!.status).toBe(503);
    expect(requireBearer(withAuth(), '', 'TOKEN')!.status).toBe(503);
  });

  test('names the variable so the misconfiguration is diagnosable', async () => {
    const response = requireBearer(withAuth(), undefined, 'CRON_SECRET')!;
    expect(((await response.json()) as { error: string }).error).toContain('CRON_SECRET');
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
