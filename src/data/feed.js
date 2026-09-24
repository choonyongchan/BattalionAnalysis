/**
 * Reads the dashboard's data from Neon through `/api/dashboard`.
 *
 * One GET, one JSON reply holding every tab, shaped as the tabs the retired Google Sheet
 * held (`lib/dashboard.ts#loadTabs`). The caller carries no credential: the session cookie
 * `api/session.ts` issued goes with the request, and `api/dashboard.ts` checks it. That
 * check is on the server, which is the whole point — a check in this file would be one the
 * caller could skip by reading the page source.
 */

import { toRecords } from './records.js';
import {
  FORMSG_HEADERS,
  OPTIONAL_TABS,
  PERSONNEL_HEADERS,
  ROSTER_HEADERS,
  SFT_HEADERS,
  STRENGTH_HEADERS,
  SUBMISSION_HEADERS,
  TABS,
} from './tabs.js';
import { setActiveSettings } from '../model/settings/active.js';
import { defaultSettings } from '../model/settings/resolve.js';

/** @type {string} The read route, served by the same Vercel deployment as this page. */
const API = '/api/dashboard';

/**
 * What each refusal means to the person reading the screen.
 * @type {!Object<number, string>}
 */
const HTTP_ERRORS = {
  401: 'The session has ended. Enter the password again.',
  503:
    'The dashboard is not configured yet. Set DASHBOARD_PASSWORD and DASHBOARD_DATABASE_URL ' +
    'on Vercel.',
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
  { key: 'sft', tab: TABS.SFT, headers: SFT_HEADERS },
];

/**
 * Requests every tab from the read route.
 * @returns {!Promise<!Object>} The reply body: tabs, generatedAt, settings.
 * @throws {Error} If the session is over, or the route is unreachable or failing.
 */
async function fetchTabs() {
  let response;
  try {
    response = await fetch(API, { credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach the dashboard. Check the network connection and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    const reference = body.reference ? ', reference ' + body.reference : '';
    const error = new Error(
      HTTP_ERRORS[response.status] ||
        'The dashboard could not load its data (HTTP ' + response.status + reference + ').'
    );
    error.code = body.error || String(response.status);
    error.status = response.status;
    throw error;
  }
  return body;
}

/**
 * Maps one optional tab, recording why it is empty rather than throwing.
 * @param {!Object<string, !Array<!Array<*>>>} tabs Raw tabs from the read route.
 * @param {{key: string, tab: string, headers: string[]}} spec The tab to read.
 * @param {!Object<string, string>} notes Collects a note per empty or unreadable tab.
 * @returns {Array<!Object>} The tab's records, or [].
 */
function readOptional(tabs, spec, notes) {
  let records;
  try {
    records = toRecords(tabs[spec.tab], spec.headers, spec.tab);
  } catch (error) {
    notes[spec.tab] = error.message;
    return [];
  }
  if (records.length === 0) {
    notes[spec.tab] = 'There are no "' + spec.tab + '" rows yet. ' + OPTIONAL_TABS[spec.tab];
  }
  return records;
}

/**
 * What an empty calendar list means for the charts, keyed by the name the Settings page shows.
 * @type {!Object<string, string>}
 */
const EMPTY_CALENDAR_NOTES = {
  'Public Holidays': 'No public holidays are set, so none are marked on any chart. Add them under Settings → Calendar.',
  Rotations: 'No rotations are set, so rotational grouping is unavailable. Add them under Settings → Calendar.',
};

/**
 * Maps a dashboard reply to the dataset the pages read, and makes its settings the active ones.
 *
 * Holidays and rotations come from the calendar section but keep the record shape the model
 * has always read (`rotations` with `start_date`/`end_date`), so no model code changes.
 * @param {!Object} body The `/api/dashboard` reply.
 * @returns {!Object} Records per tab, `settings`, `settingsMeta`, `holidays`, `rotations`,
 *     `generatedAt`, `notes`, `available` and `canEdit`.
 * @throws {Error} When a required tab's header row no longer matches.
 */
export function datasetFromReply(body) {
  const tabs = body.tabs || {};
  const settings = (body.settings && body.settings.values) || defaultSettings();
  const notes = {};
  const data = {
    generatedAt: body.generatedAt || '',
    notes,
    available: {},
    settings,
    settingsMeta: (body.settings && body.settings.meta) || {},
    canEdit: body.canEdit === true,
  };

  REQUIRED_TABS.forEach((spec) => {
    data[spec.key] = toRecords(tabs[spec.tab], spec.headers, spec.tab);
    data.available[spec.key] = true;
  });
  OPTIONAL_TAB_SPECS.forEach((spec) => {
    data[spec.key] = readOptional(tabs, spec, notes);
    data.available[spec.key] = !(spec.tab in notes);
  });

  data.holidays = settings.calendar.holidays.map((holiday) => ({ date: holiday.date, name: holiday.name }));
  data.rotations = settings.calendar.rotations.map((rotation) => ({
    name: rotation.name,
    start_date: rotation.start,
    end_date: rotation.end,
  }));
  data.available.holidays = data.holidays.length > 0;
  data.available.rotations = data.rotations.length > 0;
  if (!data.available.holidays) notes['Public Holidays'] = EMPTY_CALENDAR_NOTES['Public Holidays'];
  if (!data.available.rotations) notes.Rotations = EMPTY_CALENDAR_NOTES.Rotations;

  setActiveSettings(settings);
  return data;
}

/**
 * Loads every tab the dashboard reads and maps it to typed records.
 *
 * A required tab whose header row no longer matches throws from `toRecords` naming the
 * tab and the missing column. Optional tabs never throw; an empty one is recorded in
 * `notes` and shown on the Settings page.
 * @returns {!Promise<!Object>} Records per tab, plus `settings`, `generatedAt` and `notes`.
 */
export function loadAll() {
  return fetchTabs().then(datasetFromReply);
}
