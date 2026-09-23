/**
 * The dashboard's session token.
 *
 * The token is what a browser holds instead of the password, so the tests that matter are
 * the refusals: an expired token, a tampered one, and one signed with the password that
 * has since been rotated. Each of those is someone keeping access they should have lost.
 */
import { describe, expect, test } from 'bun:test';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  isSameOrigin,
  issueSession,
  readCookie,
  sessionCookie,
  verifySession,
} from '../../lib/session.ts';

const SECRET = 'a-long-dashboard-password';
const NOW = Date.UTC(2026, 8, 23, 8, 0, 0);
const HOUR = 60 * 60 * 1000;

describe('issueSession and verifySession', () => {
  test('a token it just issued is accepted', () => {
    const token = issueSession(SECRET, 12 * HOUR, NOW);
    expect(verifySession(SECRET, token, NOW)).toBe(true);
    expect(verifySession(SECRET, token, NOW + 11 * HOUR)).toBe(true);
  });

  test('a token is refused once it expires', () => {
    const token = issueSession(SECRET, HOUR, NOW);
    expect(verifySession(SECRET, token, NOW + HOUR + 1)).toBe(false);
  });

  test('a token signed with the old password is refused after a rotation', () => {
    const token = issueSession(SECRET, 12 * HOUR, NOW);
    expect(verifySession('the-new-password', token, NOW)).toBe(false);
  });

  test('a tampered expiry does not verify, so a token cannot extend itself', () => {
    const token = issueSession(SECRET, HOUR, NOW);
    const [version, expiry, signature] = token.split('.');
    const longer = [version, String(Number(expiry) + 100 * HOUR), signature].join('.');
    expect(verifySession(SECRET, longer, NOW)).toBe(false);
  });

  test('nonsense is refused rather than thrown at', () => {
    for (const token of ['', 'x', 'v1.abc.def', 'v9.1.2.3', SECRET]) {
      expect(verifySession(SECRET, token, NOW)).toBe(false);
    }
  });

  test('an unset password verifies nothing, so the route fails closed', () => {
    const token = issueSession(SECRET, HOUR, NOW);
    expect(verifySession('', token, NOW)).toBe(false);
  });
});

describe('the cookie the session is carried in', () => {
  test('is HttpOnly, Secure, SameSite=Strict and expires with the token', () => {
    const header = sessionCookie('tok', 12 * HOUR);
    expect(header).toContain(`${SESSION_COOKIE}=tok`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=43200');
  });

  test('clearing it sends an empty value that expires at once', () => {
    expect(clearSessionCookie()).toContain('Max-Age=0');
  });

  test('reads one cookie out of a header carrying several', () => {
    const request = new Request('https://example.test/', {
      headers: { cookie: `other=1; ${SESSION_COOKIE}=abc.def; last=2` },
    });
    expect(readCookie(request, SESSION_COOKIE)).toBe('abc.def');
    expect(readCookie(request, 'missing')).toBeNull();
    expect(readCookie(new Request('https://example.test/'), SESSION_COOKIE)).toBeNull();
  });
});

describe('isSameOrigin, the check behind every cookie-authorised write', () => {
  /**
   * Builds a request with the headers a browser would set.
   *
   * @param headers The headers to set.
   * @returns The request.
   */
  function from(headers: Record<string, string>): Request {
    return new Request('https://internal.host.invalid/api/parade', { method: 'POST', headers });
  }

  test("the browser's own verdict is taken first, and survives a proxy", () => {
    // `request.url` is the proxy's host here, not the one the browser typed.
    expect(isSameOrigin(from({ 'sec-fetch-site': 'same-origin', origin: 'https://dash.example' }))).toBe(true);
    expect(isSameOrigin(from({ 'sec-fetch-site': 'cross-site', origin: 'https://dash.example' }))).toBe(false);
    expect(isSameOrigin(from({ 'sec-fetch-site': 'same-site' }))).toBe(false);
  });

  test('without it, the Origin must match the host the request was addressed to', () => {
    expect(isSameOrigin(from({ origin: 'https://dash.example', host: 'dash.example' }))).toBe(true);
    expect(isSameOrigin(from({ origin: 'https://evil.test', host: 'dash.example' }))).toBe(false);
  });

  test('a request carrying neither header is refused', () => {
    expect(isSameOrigin(from({}))).toBe(false);
    expect(isSameOrigin(from({ host: 'dash.example' }))).toBe(false);
    expect(isSameOrigin(from({ origin: 'not a url', host: 'dash.example' }))).toBe(false);
  });
});
