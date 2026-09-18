/**
 * When each company filed its parade state.
 *
 * "Parade State Responses" is read through a column projection — `Timestamp` and
 * `parade_response_id` only, the message body is deliberately absent (see `tabs.js`) — so
 * the id is the only field that says which company and which parade a timestamp belongs
 * to. `parade_response_id` is shaped `Company_yyyy-MM-dd_SESSION`, e.g.
 * `Archer_2026-07-22_FPS`, and is parsed rather than guessed at.
 *
 * The tab is optional; the feed returns `[]` when it does not exist, and every function
 * here accepts that without throwing.
 *
 * The point of this module is absence, not presence: `filingsOn` always returns all six
 * companies, because a chart built only from who filed cannot show who did not.
 *
 * Every function here is pure.
 */

import { COMPANIES } from './domain.js';
import { toIsoDate, toText, toTimeOfDay } from './values.js';

/** @type {string} Session used when a caller does not name one. */
export const DEFAULT_SESSION = 'FPS';

/** @type {!RegExp} Shape of `parade_response_id`: `Company_yyyy-MM-dd_SESSION`. */
const ID_PATTERN = /^([A-Za-z]+)_(\d{4}-\d{2}-\d{2})_([A-Za-z0-9]+)$/;

/**
 * Parses one submissions row into a filing, or null when it cannot be trusted.
 * @param {!Object} row A "Parade State Responses" row: `Timestamp`, `parade_response_id`.
 * @returns {?{company: string, date: string, session: string, at: ?Object, id: string}}
 *     The filing, or null when the id does not parse or names an unknown company.
 */
function parseFiling_(row) {
  const id = toText(row && row.parade_response_id);
  const match = ID_PATTERN.exec(id);
  if (!match) {
    return null;
  }
  const [, company, rawDate, session] = match;
  if (!COMPANIES.includes(company)) {
    return null;
  }
  const date = toIsoDate(rawDate);
  if (!date) {
    return null;
  }
  return { company, date, session, at: toTimeOfDay(row.Timestamp), id };
}

/**
 * Compares two filings by date, then by time of day.
 *
 * A filing with no time of day sorts before any timed filing on the same date, so a
 * missing clock time is visible at the front of its day rather than lost in the middle.
 * @param {!Object} a One filing.
 * @param {!Object} b The other filing.
 * @returns {number} Standard comparator result.
 */
function byDateThenTime_(a, b) {
  const byDate = a.date.localeCompare(b.date);
  if (byDate !== 0) {
    return byDate;
  }
  const aMinutes = a.at ? a.at.minutes : -1;
  const bMinutes = b.at ? b.at.minutes : -1;
  return aMinutes - bMinutes;
}

/**
 * Parses "Parade State Responses" rows into filings.
 * @param {Array<!Object>} rows Rows from the (optional) tab; `[]` when absent.
 * @returns {Array<{company: string, date: string, session: string, at: ?Object, id: string}>}
 *     Filings whose id parsed to a known company, sorted by date then time.
 */
export function toFilings(rows) {
  return (rows || [])
    .map(parseFiling_)
    .filter((filing) => filing !== null)
    .sort(byDateThenTime_);
}

/**
 * Reduces filings to the latest one per company, for one date and session.
 *
 * When a company files twice in a day the later timestamp wins: it is the more
 * up-to-date word on who paraded.
 * @param {Array<!Object>} filings Filings from `toFilings`.
 * @param {string} isoDate ISO 'yyyy-MM-dd' to filter to.
 * @param {string=} session Session to filter to; defaults to 'FPS'.
 * @returns {!Map<string, !Object>} The latest filing per company that filed.
 */
export function latestFilingPerCompany(filings, isoDate, session) {
  const targetSession = session || DEFAULT_SESSION;
  const latest = new Map();
  filings.forEach((filing) => {
    if (filing.date !== isoDate || filing.session !== targetSession) {
      return;
    }
    const current = latest.get(filing.company);
    if (!current || byDateThenTime_(current, filing) <= 0) {
      latest.set(filing.company, filing);
    }
  });
  return latest;
}

/**
 * Lists every company's filing status for one date and session.
 *
 * Always covers all six companies in COMPANIES order — the missing ones are the finding.
 * @param {Array<!Object>} filings Filings from `toFilings`.
 * @param {string} isoDate ISO 'yyyy-MM-dd' to look at.
 * @param {string=} session Session to look at; defaults to 'FPS'.
 * @returns {Array<{company: string, filed: boolean, at: ?Object}>} One entry per company.
 */
export function filingsOn(filings, isoDate, session) {
  const latest = latestFilingPerCompany(filings, isoDate, session);
  return COMPANIES.map((company) => {
    const filing = latest.get(company);
    return filing ? { company, filed: true, at: filing.at } : { company, filed: false, at: null };
  });
}

/**
 * Describes an id that failed to parse.
 * @param {string} id Raw `parade_response_id`.
 * @param {string} reason Why it failed.
 * @returns {{kind: string, message: string}} The issue.
 */
function unparseableIdIssue_(id, reason) {
  const label = id === '' ? '(blank)' : id;
  return { kind: 'unparseable-id', message: `Parade response id "${label}" ${reason}.` };
}

/**
 * Flags data-quality problems in "Parade State Responses", for the Settings page.
 * @param {Array<!Object>} rows Rows from the (optional) tab; `[]` when absent.
 * @returns {Array<{kind: string, message: string}>} Issues found, in row order, with
 *     duplicate filings appended last.
 */
export function filingIssues(rows) {
  const issues = [];
  const seen = new Map();
  (rows || []).forEach((row) => {
    const id = toText(row && row.parade_response_id);
    const match = ID_PATTERN.exec(id);
    if (!match) {
      issues.push(unparseableIdIssue_(id, 'could not be parsed'));
      return;
    }
    const [, company, rawDate, session] = match;
    if (!COMPANIES.includes(company)) {
      issues.push(unparseableIdIssue_(id, `names an unknown company "${company}"`));
      return;
    }
    if (!toTimeOfDay(row.Timestamp)) {
      issues.push({
        kind: 'no-time-of-day',
        message: `Filing "${id}" has a timestamp with no time of day.`,
      });
    }
    const key = company + '|' + rawDate + '|' + session;
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  seen.forEach((count, key) => {
    if (count > 1) {
      const [company, date, session] = key.split('|');
      issues.push({
        kind: 'duplicate-filing',
        message: `${company} filed ${session} on ${date} ${count} times.`,
      });
    }
  });
  return issues;
}
