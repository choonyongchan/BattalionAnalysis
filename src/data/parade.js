/**
 * The Deposit page's calls to `/api/parade`, the Vercel intake.
 *
 * Same-origin, like `/api/dashboard`, so the session cookie `api/session.ts` issued goes
 * with every call and nothing here handles a credential. `credentials: 'same-origin'` is
 * the fetch default, and is written out because it is the thing that makes these calls
 * work at all.
 */

/** @type {string} The intake route, served by the same Vercel deployment as this page. */
const API = '/api/parade';

/**
 * What each non-JSON failure means to the person at the screen.
 * @type {!Object<number, string>}
 */
const HTTP_ERRORS = {
  401: 'The session has ended. Reload the page and unlock it again.',
  404: 'That parade state no longer exists. Reload the list.',
  413: 'That is too long to be a parade state.',
  503: 'The intake is not configured yet. Set DASHBOARD_PASSWORD on Vercel.',
};

/**
 * Calls the intake and reads its JSON answer.
 *
 * A 422 is not thrown: it is the parser saying what to correct, which the page shows.
 * @param {string} method The HTTP method.
 * @param {string} query The query string, e.g. '?id=4', or ''.
 * @param {!Object=} body The JSON body, if any.
 * @returns {!Promise<!Object>} The parsed answer.
 * @throws {Error} With a readable message, for anything but a 2xx or 422.
 */
async function call(method, query, body) {
  let response;
  try {
    response = await fetch(API + query, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the intake. Check the connection and try again.');
  }
  const answer = await response.json().catch(() => ({}));
  if (response.ok || response.status === 422) return answer;
  throw new Error(HTTP_ERRORS[response.status] || answer.error || `The intake answered ${response.status}.`);
}

/**
 * Lists every stored message, newest first, without text.
 * @returns {!Promise<!Array<!Object>>} Message summaries.
 */
export async function listMessages() {
  return (await call('GET', '')).messages || [];
}

/**
 * Reads one message's text.
 * @param {number} id The message id.
 * @returns {!Promise<{id: number, body: string}>} The message.
 */
export function getMessage(id) {
  return call('GET', '?id=' + id);
}

/**
 * Deposits a parade state and parses it.
 * @param {string} body The parade-state text.
 * @returns {!Promise<!Object>} The outcome: `status` is parsed, already_parsed, rejected,
 *     needs_review or invalid.
 */
export function depositMessage(body) {
  return call('POST', '', { body });
}

/**
 * Replaces a message's text and everything parsed from it.
 * @param {number} id The message id.
 * @param {string} body The corrected text.
 * @returns {!Promise<!Object>} The outcome, as for depositMessage.
 */
export function editMessage(id, body) {
  return call('PUT', '?id=' + id, { body });
}

/**
 * Deletes a message and everything parsed from it.
 * @param {number} id The message id.
 * @returns {!Promise<!Object>} The acknowledgement.
 */
export function deleteMessage(id) {
  return call('DELETE', '?id=' + id);
}
