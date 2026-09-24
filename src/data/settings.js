/**
 * The Settings page's writes, through `/api/settings`, and the settings the app shell reads.
 *
 * Writes carry only the session cookies; whether the caller may edit is decided on the server
 * (`api/settings.ts`), where it cannot be skipped. After a successful write the caller
 * refreshes the dashboard, which is how every page picks up the new settings.
 *
 * `unitSettings` and `refreshMs` exist so `app/`, which may import only `data/` and `theme/`,
 * can read settings without reaching into `model/`.
 */

import { settingOf } from '../model/settings/active.js';

/** @type {string} The write route, served by the same Vercel deployment as this page. */
const API = '/api/settings';

/**
 * What each refusal means to the person at the form.
 * @type {!Object<number, string>}
 */
const HTTP_ERRORS = {
  400: 'The dashboard sent a request the server could not read. Reload and try again.',
  401: 'Editing has ended. Unlock editing again.',
  403: 'Settings can only be changed from the dashboard itself.',
  409: 'Someone else saved this section. Reload to see their version.',
  422: 'Some fields need fixing.',
  503: 'Editing is not configured. Set SETTINGS_PASSWORD on Vercel, different from DASHBOARD_PASSWORD.',
};

/**
 * Sends one write and turns a refusal into a readable error.
 * @param {string} url The route, with any query string.
 * @param {!RequestInit} init The request.
 * @returns {!Promise<!Object>} The reply body.
 * @throws {Error} With `status`, and `errors` on a 422.
 */
async function send_(url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach the dashboard. Check the network connection and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    const error = new Error(HTTP_ERRORS[response.status] || 'The settings could not be saved (HTTP ' + response.status + ').');
    error.status = response.status;
    error.errors = body.errors || [];
    throw error;
  }
  return body;
}

/**
 * Saves one section.
 * @param {string} section The section name.
 * @param {!Object} value The edited value.
 * @param {number} version The version the form was opened on (0 for a default).
 * @returns {!Promise<{version: number, warnings: !Array<!Object>}>} The new version and any
 *     warnings.
 */
export async function saveSection(section, value, version) {
  const body = await send_(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, value, version }),
  });
  return { version: body.version, warnings: body.warnings || [] };
}

/**
 * Resets one section to its default.
 * @param {string} section The section name.
 * @param {number} version The version shown on the page.
 * @returns {!Promise<void>} Resolves once reset.
 */
export async function resetSection(section, version) {
  await send_(API + '?section=' + encodeURIComponent(section) + '&version=' + version, { method: 'DELETE' });
}

/**
 * The unit section in force, for the logo, wordmark and page title.
 * @returns {{name: string, pageTitle: string, logo: string}} The unit settings.
 */
export function unitSettings() {
  return settingOf('unit');
}

/**
 * How often an open dashboard re-reads, from the Session settings.
 * @returns {number} Milliseconds.
 */
export function refreshMs() {
  return settingOf('session').refreshSeconds * 1000;
}
