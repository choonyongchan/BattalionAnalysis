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
 * The point of this module is absence, not presence: `filingsOn` always returns all five
 * companies, because a chart built only from who filed cannot show who did not.
 *
 * Every function here is pure.
 */

import { COMPANIES } from '../../../shared/domain.js';
import { toIsoDate, toText, toTimeOfDay } from '../../../shared/values.js';

/** @type {string} Session used when a caller does not name one. */
const DEFAULT_SESSION = 'FPS';

/** @type {!RegExp} Shape of `parade_response_id`: `Company_yyyy-MM-dd_SESSION`. */
const ID_PATTERN = /^([A-Za-z]+)_(\d{4}-\d{2}-\d{2})_([A-Za-z0-9]+)$/;

/**
 * Parses one submissions row into a filing, or null when it cannot be trusted.
 * @param {!Object} row A "Parade State Responses" row: `Timestamp`, `parade_response_id`.
 * @returns {?{company: string, date: string, session: string, at: ?Object, filedOn: ?string,
 *     id: string}} The filing, or null when the id does not parse or names an unknown company.
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
  return { company, date, session, at: toTimeOfDay(row.Timestamp), filedOn: toIsoDate(row.Timestamp), id };
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



/** @type {number} The first-parade cut-off, in minutes after midnight (08:00). ponytail: a constant; a Settings field when someone needs to change it. */
export const FILING_CUTOFF_MINUTES = 8 * 60;

/**
 * How late each company's first parade state arrived on each day: minutes past the cut-off.
 *
 * The first filing of the day counts, not a later correction. A filing that arrived on a
 * later day than its parade has no cell, so it cannot swamp the scale; it is counted in
 * `nextDay` instead. A day with no filing has no cell either.
 * @param {Array<!Object>} filings Filings from `toFilings`.
 * @param {string[]} days The days to cover, ascending.
 * @param {string=} session Session to read; defaults to 'FPS'.
 * @returns {{cells: Array<{row: string, column: string, value: number, at: string}>,
 *     onTime: !Object<string, number>, filed: !Object<string, number>, nextDay: number}}
 *     One cell per company-day filed the same day, valued in minutes late (0 when on
 *     time); per company, the days filed on time and the days filed at all; and the
 *     filings that arrived on a later day.
 */
export function filingTimes(filings, days, session) {
  const first = new Map();
  filings
    .filter((filing) => filing.session === (session || DEFAULT_SESSION) && filing.at && days.includes(filing.date))
    .forEach((filing) => {
      const key = filing.company + '|' + filing.date;
      if (!first.has(key)) first.set(key, filing);
    });
  const onTime = Object.fromEntries(COMPANIES.map((company) => [company, 0]));
  const filed = Object.fromEntries(COMPANIES.map((company) => [company, 0]));
  let nextDay = 0;
  const cells = [];
  first.forEach((filing) => {
    filed[filing.company] += 1;
    if (filing.filedOn && filing.filedOn !== filing.date) {
      nextDay += 1;
      return;
    }
    const late = Math.max(0, filing.at.minutes - FILING_CUTOFF_MINUTES);
    if (late === 0) onTime[filing.company] += 1;
    const at = String(filing.at.hour).padStart(2, '0') + ':' + String(filing.at.minute).padStart(2, '0');
    cells.push({ row: filing.company, column: filing.date, value: late, at });
  });
  return { cells, onTime, filed, nextDay };
}
