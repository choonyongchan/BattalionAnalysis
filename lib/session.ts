/**
 * The dashboard's session: what a browser holds instead of the password.
 *
 * The password used to live in the page — first in memory, then in `localStorage` so a
 * refresh did not ask again. Anything that could run script in the page, and anyone at an
 * unlocked browser, could read it, and that one password also authorises writes through
 * `/api/parade`. A session token fixes that: the browser holds a signed, expiring token in
 * an `HttpOnly` cookie it cannot read, and the password is sent exactly once, to
 * `api/session.ts`.
 *
 * The token carries nothing but its own expiry — there are no accounts to name, and the
 * dashboard deliberately has no per-person identity (`docs/dashboard.md`). It is signed
 * with `DASHBOARD_PASSWORD` itself, which is what makes a rotation end every open session:
 * change the password and every token signed with the old one stops verifying. There is
 * no server-side session store, because `neon-http` gives the routes no place to keep one
 * and a signature needs none.
 */
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';

/** The cookie the token travels in. */
export const SESSION_COOKIE = 'dashboard_session';

/** How long a session lasts: a working day, so a commander logs in once. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** The token format, so a later change can be told apart rather than guessed at. */
const VERSION = 'v1';

/**
 * Signs the payload with the dashboard password.
 *
 * @param secret The `DASHBOARD_PASSWORD` in force.
 * @param payload The token's signed part, `v1.<expiry>`.
 * @returns The signature, base64url.
 */
function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * Issues a session token that expires `ttlMs` from now.
 *
 * @param secret The `DASHBOARD_PASSWORD` in force.
 * @param ttlMs How long the session should last, in milliseconds.
 * @param now Milliseconds since the epoch; passed in so tests hold the clock.
 * @returns The token, `v1.<expiry>.<signature>`.
 */
export function issueSession(secret: string, ttlMs: number, now: number): string {
  const payload = `${VERSION}.${now + ttlMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

/**
 * Checks a session token: right signature, and not yet expired.
 *
 * Fails closed on everything — an unset password, a malformed token, an unknown version —
 * and compares signatures in constant time, so a wrong token cannot be tuned into a right
 * one by timing the answers.
 *
 * @param secret The `DASHBOARD_PASSWORD` in force, or '' when none is configured.
 * @param token The token from the cookie, or null.
 * @param now Milliseconds since the epoch.
 * @returns Whether the token is valid right now.
 */
export function verifySession(secret: string, token: string | null, now: number): boolean {
  if (!secret || !token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  // Read with a default rather than destructured: under `noUncheckedIndexedAccess` an
  // element is `string | undefined`, and a token is exactly the input that must not be
  // trusted to have the shape it claims.
  const version = parts[0] ?? '';
  const expiry = parts[1] ?? '';
  const signature = parts[2] ?? '';
  if (version !== VERSION || !/^\d+$/.test(expiry) || Number(expiry) <= now) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(signature), digest(sign(secret, `${version}.${expiry}`)));
}

/**
 * Builds the `Set-Cookie` header carrying a session.
 *
 * `HttpOnly` keeps the token out of reach of any script on the page, `Secure` keeps it off
 * plaintext connections (browsers exempt `localhost`, so local development still works),
 * and `SameSite=Strict` means another site cannot make the browser spend it — which is
 * what stops a cross-site request writing through `/api/parade`.
 *
 * @param token The token to set.
 * @param ttlMs How long the cookie should live, in milliseconds.
 * @returns The header value.
 */
export function sessionCookie(token: string, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Builds the `Set-Cookie` header that deletes the session.
 *
 * @returns The header value.
 */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Reads one cookie from a request.
 *
 * @param request The incoming request.
 * @param name The cookie's name.
 * @returns Its value, or null when the request carries no such cookie.
 */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      return part.slice(index + 1).trim();
    }
  }
  return null;
}

/**
 * Whether a request carries a valid session.
 *
 * @param request The incoming request.
 * @param secret The `DASHBOARD_PASSWORD` in force, or undefined when none is configured.
 * @param now Milliseconds since the epoch.
 * @returns Whether the session cookie verifies.
 */
export function hasSession(request: Request, secret: string | undefined, now: number): boolean {
  return verifySession(secret ?? '', readCookie(request, SESSION_COOKIE), now);
}

/**
 * Whether a state-changing request came from the dashboard itself.
 *
 * `SameSite=Strict` already stops another site spending the cookie, but it is one browser
 * setting between a forged form and a deposit, so this is checked as well.
 *
 * `Sec-Fetch-Site` is the browser's own verdict on where the request came from, computed
 * before it is sent and not settable by page script, so it is read first. It is also the
 * only one of the two that survives a proxy: `request.url` behind Vercel's router, or a
 * local dev proxy, is not the URL the browser typed, so comparing `Origin` against it
 * refuses honest requests. The fallback compares `Origin` against the `Host` the request
 * was addressed to, which is the public host in both places.
 *
 * A request carrying neither header is refused on the cookie path: browsers send at least
 * one on a write, and a caller that is not a browser has the bearer path.
 *
 * @param request The incoming request.
 * @returns Whether the request came from this deployment's own pages.
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
