/**
 * Starts and ends a session at `/api/session`: the only place the password is sent, in a POST body,
 * in exchange for an `HttpOnly` cookie the page cannot read.
 */

import { ApiError, send } from './api.ts';

const API = '/api/session';

const HTTP_ERRORS: Record<number, string> = {
  401: 'That password is not right.',
  503: 'The dashboard is not configured yet. Set DASHBOARD_PASSWORD and DASHBOARD_DATABASE_URL on Vercel.',
};

/** Exchanges the password for a session cookie; resolves with whether it may also edit settings. */
export async function startSession(password: string): Promise<{ canEdit: boolean }> {
  const { ok, status, body } = await send(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!ok) throw new ApiError(HTTP_ERRORS[status] ?? `The dashboard could not open (HTTP ${status}).`, status);
  return { canEdit: body.canEdit === true };
}

/** Ends the session at the server; never throws, since a reload follows either way. */
export async function endSession(): Promise<void> {
  try {
    await send(API, { method: 'DELETE' });
  } catch {
    // A dropped connection must not trap the viewer here.
  }
}

/** Unlocks editing with the settings password (the same login call, reissuing both cookies). */
export async function unlockEditing(password: string): Promise<void> {
  const { canEdit } = await startSession(password);
  if (!canEdit) {
    throw new Error('That password opens the dashboard but not editing. Enter the settings password.');
  }
}
