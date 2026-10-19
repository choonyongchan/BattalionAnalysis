/**
 * The dashboard's signed, expiring session cookies: the browser holds a token it cannot read, never the
 * password. Keys derive from the password and `SESSION_SECRET`, so rotating either ends every session.
 */
import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { bearerToken, sameSecret } from './http.ts';

/** The cookie the token travels in. */
export const SESSION_COOKIE = 'dashboard_session';

/** How long a session lasts: a working day, so a commander logs in once. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** The second cookie, held only by someone who logged in with `SETTINGS_PASSWORD`. */
export const SETTINGS_COOKIE = 'settings_session';

/** The token format, so a later change can be told apart rather than guessed at. */
const VERSION = 'v1';

/** Whether sessions can be issued at all: `SESSION_SECRET` is set. */
export function sessionsConfigured(): boolean {
  return Boolean(process.env.SESSION_SECRET);
}

/**
 * Signs the payload with a key derived from the password and `SESSION_SECRET`; the password alone would make
 * every cookie an offline password-guessing oracle.
 */
function sign(secret: string, payload: string): string {
  const pepper = process.env.SESSION_SECRET;
  if (!pepper) throw new Error('SESSION_SECRET is not configured.');
  const key = createHmac('sha256', pepper).update(secret).digest();
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** Issues a session token that expires `ttlMs` from now. */
export function issueSession(secret: string, ttlMs: number, now: number): string {
  const payload = `${VERSION}.${now + ttlMs}`;
  return `${payload}.${sign(secret, payload)}`;
}

/** Checks a session token: right signature (compared in constant time) and not yet expired; fails closed on anything else. */
export function verifySession(secret: string, token: string | null, now: number): boolean {
  if (!secret || !token || !sessionsConfigured()) return false;
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

/** The `Set-Cookie` header carrying a session: `HttpOnly` (no script reads it), `Secure`, `SameSite=Strict`. */
export function sessionCookie(token: string, ttlMs: number, name: string = SESSION_COOKIE): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${name}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/** Builds the `Set-Cookie` header that deletes the session. */
export function clearSessionCookie(name: string = SESSION_COOKIE): string {
  return `${name}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Reads one cookie from a request. */
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

/** Whether a request carries a valid session. */
export function hasSession(request: Request, secret: string | undefined, now: number): boolean {
  return verifySession(secret ?? '', readCookie(request, SESSION_COOKIE), now);
}

/**
 * Whether a state-changing request came from the dashboard itself: `Sec-Fetch-Site` first (the browser's own
 * verdict, and it survives a proxy), else `Origin` against `Host`; neither header means no.
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

/** Whether a request is the dashboard, allowed to read or change what `/api/parade` and `/api/sft` manage. */
export function isDashboardCaller(request: Request, password: string | undefined, now: number): boolean {
  if (hasSession(request, password, now)) return request.method === 'GET' || isSameOrigin(request);
  const token = bearerToken(request);
  return Boolean(password && token && sameSecret(token, password));
}

/**
 * The secret that grants editing: `SETTINGS_PASSWORD`, unless it is unset or the same as
 * `DASHBOARD_PASSWORD`.
 */
export function editSecret(
  dashboardPassword: string | undefined,
  settingsPassword: string | undefined
): string | undefined {
  return settingsPassword && settingsPassword !== dashboardPassword ? settingsPassword : undefined;
}

/** Whether a request carries a valid editing session. */
export function hasSettingsSession(request: Request, secret: string | undefined, now: number): boolean {
  return verifySession(secret ?? '', readCookie(request, SETTINGS_COOKIE), now);
}
