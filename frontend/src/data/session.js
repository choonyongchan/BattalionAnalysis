/**
 * The two calls that start and end a session: `/api/session`.
 *
 * This is the only place in the browser the password is ever sent, and it is sent in a
 * POST body rather than a header or a query string — a query string lands in browser
 * history, referrer headers and request logs. What comes back is an `HttpOnly` cookie the
 * page cannot read, which every other call then carries without handling a credential.
 */

/** @type {string} The login route, served by the same Vercel deployment as this page. */
const API = '/api/session';

/**
 * What each refusal means to the person reading the screen.
 * @type {!Object<number, string>}
 */
const HTTP_ERRORS = {
  401: 'That password is not right.',
  503:
    'The dashboard is not configured yet. Set DASHBOARD_PASSWORD and DASHBOARD_DATABASE_URL ' +
    'on Vercel.',
};

/**
 * Exchanges the password for a session cookie.
 * @param {string} password The password the viewer typed.
 * @returns {!Promise<{canEdit: boolean}>} Resolves once the cookie is set, with whether this
 *     session may also change settings.
 * @throws {Error} With a readable message, when the password is refused or the route is
 *     unreachable.
 */
export async function startSession(password) {
  let response;
  try {
    response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password }),
    });
  } catch {
    throw new Error('Could not reach the dashboard. Check the network connection and try again.');
  }
  if (!response.ok) {
    const error = new Error(
      HTTP_ERRORS[response.status] || 'The dashboard could not open (HTTP ' + response.status + ').'
    );
    error.status = response.status;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  return { canEdit: body.canEdit === true };
}

/**
 * Ends the session at the server, which is what makes Lock more than a reload.
 * @returns {!Promise<void>} Resolves whether or not the call succeeded.
 */
export async function endSession() {
  try {
    await fetch(API, { method: 'DELETE', credentials: 'same-origin' });
  } catch {
    // The reload follows either way; a dropped connection must not trap the viewer here.
  }
}

/**
 * Unlocks editing for a viewer already reading the dashboard, with the settings password.
 *
 * It is the same login call: the settings password also opens the dashboard, so the read
 * session is simply reissued alongside the edit session.
 * @param {string} password The settings password the viewer typed.
 * @returns {!Promise<void>} Resolves once editing is unlocked.
 * @throws {Error} When the password is wrong, or is the read-only password.
 */
export async function unlockEditing(password) {
  const { canEdit } = await startSession(password);
  if (!canEdit) {
    throw new Error('That password opens the dashboard but not editing. Enter the settings password.');
  }
}
