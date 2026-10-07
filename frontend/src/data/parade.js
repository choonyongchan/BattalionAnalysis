/**
 * The Deposit page's calls to `/api/parade`, the Vercel intake, through `api.js#callJson`.
 */

import { callJson } from './api.js';

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
 * Calls the intake.
 * @param {string} method The HTTP method.
 * @param {string} query The query string, e.g. '?id=4', or ''.
 * @param {!Object=} body The JSON body, if any.
 * @returns {!Promise<!Object>} The parsed answer.
 * @throws {Error} With a readable message, for anything but a 2xx or 422.
 */
function call(method, query, body) {
  return callJson(API, method, query, body, HTTP_ERRORS);
}

/**
 * Lists every stored message, newest first, without text.
 * @returns {!Promise<!Array<!Object>>} Message summaries.
 */
export async function listMessages() {
  return (await call('GET', '')).messages || [];
}

/**
 * Reads one message's text, and the stored reasons it produced no rows.
 * @param {number} id The message id.
 * @returns {!Promise<{id: number, body: string, error: ?string}>} The message.
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
