/**
 * Relays an accepted parade state to the Apps Script web app.
 *
 * This replaced a Google Form submission. The Form was a pure relay, there only
 * because `onFormSubmit` was the one trigger that fired reliably — an
 * installable trigger does not fire for API writes, so nothing happened when
 * the sheet was written directly. Posting to the web app removes the hop, the
 * scraped `entry.<digits>` id and the script that discovered it: the handler
 * appends the row and runs the pipeline in one call.
 *
 * Redirects are followed. An Apps Script web app answers through a 302, and
 * following it re-sends the POST body, so the handler can run twice for one
 * call. That is safe here precisely because the handler dedupes on
 * `messageId`.
 */

/** @type {string} The route parameter identifying this intake. */
const PARADE_STATE_ROUTE = 'paradestate';

/**
 * Builds the URL for the parade-state intake.
 *
 * @param {string} baseUrl The web app's /exec URL.
 * @returns {string} The URL with the route parameter appended.
 */
export function buildIntakeUrl(baseUrl) {
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}route=${PARADE_STATE_ROUTE}`;
}

/**
 * Posts one parade state to the web app.
 *
 * @param {string} text The raw parade-state text.
 * @param {string} messageId Baileys message id.
 * @param {Object} config Resolved configuration from loadConfig().
 * @returns {Promise<{appended: boolean, rowIndex: ?number}>} Whether the call
 *   created a row — false means the message was already recorded — and the row
 *   it occupies.
 * @throws {Error} If the request fails, or the handler reports it was rejected.
 */
export async function relayParadeState(text, messageId, config) {
  const response = await fetch(buildIntakeUrl(config.appsScriptUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: config.appsScriptToken, messageId, text }),
  });

  if (!response.ok) {
    throw new Error(`Apps Script rejected the relay with HTTP ${response.status}.`);
  }

  // ContentService cannot set a status code, so the outcome is in the body, not
  // the status. A 200 saying ok:false is a permanent rejection, not a hiccup.
  const body = await response.json();
  if (!body.ok) {
    throw new Error(`Apps Script rejected the relay: ${body.error}.`);
  }

  return { appended: Boolean(body.appended), rowIndex: body.rowIndex ?? null };
}
