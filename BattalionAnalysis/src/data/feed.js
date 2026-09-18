/**
 * Reads the spreadsheet through the Apps Script feed.
 *
 * One POST carrying the password, one JSON reply holding every tab. The password is
 * checked on the Apps Script side (`src/dashboard/DashboardFeed.js`), which is the whole
 * point: a check in this file would be a check the caller could skip by reading the page
 * source, and the spreadsheet would have to be public for the data to be reachable at all.
 *
 * Two request details are not stylistic, and must survive any refactor:
 *
 * - **`Content-Type: text/plain`**, even though the body is JSON. A JSON content type
 *   makes the request non-simple, so the browser sends a CORS preflight first — and Apps
 *   Script web apps do not answer `OPTIONS`, so the request would fail before the
 *   password ever left the machine. `DashboardFeed.parseBody_` reads the body with
 *   `JSON.parse` regardless.
 * - **The password goes in the body, never the URL.** A query string lands in browser
 *   history, in referrer headers, and in Google's request logs. A body does not.
 *
 * The password is held in memory by `app/auth.js` and passed in on each call, so it is
 * never written to `localStorage`, `sessionStorage`, or a cookie.
 */

import { FEED_URL } from './config.js';
import { toRecords } from './records.js';
import {
  FORMSG_HEADERS,
  HOLIDAY_HEADERS,
  OPTIONAL_TABS,
  PERSONNEL_HEADERS,
  ROSTER_HEADERS,
  ROTATION_HEADERS,
  STRENGTH_HEADERS,
  SUBMISSION_HEADERS,
  TABS,
} from './tabs.js';

/**
 * What each error code the feed can return means to the person reading the screen.
 * @type {!Object<string, string>}
 */
const FEED_ERRORS = {
  unauthorised: 'That password is not right.',
  locked_out:
    'Too many wrong passwords. The dashboard has locked itself for 15 minutes — that is ' +
    'the guard against someone guessing, so it cannot be skipped. Try again after.',
  bad_request: 'The feed could not read the request. Check FEED_URL in src/data/config.js.',
};

/**
 * The tabs the dashboard requires, and the key each lands under.
 * @type {!Array<{key: string, tab: string, headers: string[]}>}
 */
const REQUIRED_TABS = [
  { key: 'strength', tab: TABS.STRENGTH, headers: STRENGTH_HEADERS },
  { key: 'personnel', tab: TABS.PERSONNEL, headers: PERSONNEL_HEADERS },
  { key: 'roster', tab: TABS.ROSTER, headers: ROSTER_HEADERS },
];

/**
 * The tabs the dashboard works without.
 * @type {!Array<{key: string, tab: string, headers: string[]}>}
 */
const OPTIONAL_TAB_SPECS = [
  { key: 'formSg', tab: TABS.FORMSG, headers: FORMSG_HEADERS },
  { key: 'submissions', tab: TABS.SUBMISSIONS, headers: SUBMISSION_HEADERS },
  { key: 'holidays', tab: TABS.HOLIDAYS, headers: HOLIDAY_HEADERS },
  { key: 'rotations', tab: TABS.ROTATIONS, headers: ROTATION_HEADERS },
];

/**
 * Whether a feed URL has been configured.
 * @returns {boolean} True when `config.js` names an endpoint.
 */
function isConfigured() {
  return FEED_URL !== '';
}

/**
 * Requests every tab from the feed.
 * @param {string} password The password the viewer typed.
 * @returns {!Promise<!Object<string, !Array<!Array<*>>>>} Tab name to values.
 * @throws {Error} If the password is wrong, or the feed is unreachable.
 */
function fetchTabs(password) {
  return fetch(FEED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ password }),
  })
    .catch(() => {
      throw new Error(
        'Could not reach the dashboard feed. Check the network connection, and that ' +
          'FEED_URL in src/data/config.js points at a deployed web app.'
      );
    })
    .then(readBody)
    .then((body) => {
      if (!body.ok) {
        const error = new Error(FEED_ERRORS[body.error] || 'The feed refused the request.');
        error.code = body.error || 'unknown';
        throw error;
      }
      return { tabs: body.tabs || {}, generatedAt: body.generatedAt || '' };
    });
}

/**
 * Parses the feed's reply.
 *
 * An Apps Script exception is answered with an HTML error page rather than JSON, and a
 * `/exec` URL that no longer resolves returns Google's own sign-in page. Both would
 * otherwise surface as an unexplained `SyntaxError`, so a body that is not JSON is
 * reported as what it is: a deployment problem, not a password problem.
 * @param {!Response} response The feed's response.
 * @returns {!Promise<!Object>} The parsed body.
 * @throws {Error} If the body is not JSON.
 */
function readBody(response) {
  return response.text().then((text) => {
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        'The feed replied with something other than data (HTTP ' + response.status + '). ' +
          'Usually this means the web app needs redeploying, or FEED_URL is missing ' +
          '"?route=dashboard". See dashboard/README.md.'
      );
    }
  });
}

/**
 * Maps one optional tab, recording why it is empty rather than throwing.
 * @param {!Object<string, !Array<!Array<*>>>} tabs Raw tabs from the feed.
 * @param {{key: string, tab: string, headers: string[]}} spec The tab to read.
 * @param {!Object<string, string>} notes Collects a note per absent or unreadable tab.
 * @returns {Array<!Object>} The tab's records, or [].
 */
function readOptional(tabs, spec, notes) {
  if (!tabs[spec.tab]) {
    notes[spec.tab] = 'The spreadsheet has no "' + spec.tab + '" tab. ' + OPTIONAL_TABS[spec.tab];
    return [];
  }
  try {
    return toRecords(tabs[spec.tab], spec.headers, spec.tab);
  } catch (error) {
    notes[spec.tab] = error.message;
    return [];
  }
}

/**
 * Loads every tab the dashboard reads and maps it to typed records.
 *
 * A required tab whose header row no longer matches throws from `toRecords` naming the
 * tab and the missing column. Optional tabs never throw; their absence is recorded in
 * `notes` and shown on the Settings page.
 * @param {string} password The password the viewer typed.
 * @returns {!Promise<!Object>} Records per tab, plus `generatedAt` and `notes`.
 */
export function loadAll(password) {
  if (!isConfigured()) {
    return Promise.reject(
      new Error('No feed URL is set. Add one to dashboard/src/data/config.js — see dashboard/README.md.')
    );
  }

  return fetchTabs(password).then(({ tabs, generatedAt }) => {
    const notes = {};
    const data = { generatedAt, notes, available: {} };

    REQUIRED_TABS.forEach((spec) => {
      data[spec.key] = toRecords(tabs[spec.tab], spec.headers, spec.tab);
      data.available[spec.key] = true;
    });

    OPTIONAL_TAB_SPECS.forEach((spec) => {
      data[spec.key] = readOptional(tabs, spec, notes);
      data.available[spec.key] = !(spec.tab in notes);
    });

    return data;
  });
}
