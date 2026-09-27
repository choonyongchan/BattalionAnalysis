/**
 * Correcting a stored SFT record on the Deposit page.
 *
 * FormSG is the only way an SFT record is created; a clerk may only correct or delete one.
 * `validateSftEdit` is run twice, by the page before it saves and by `api/sft.ts` before it
 * writes, so the browser and the server cannot disagree about what a valid correction is.
 * Pure JavaScript: no DOM, no network.
 */

import { COMPANIES } from './domain.js';
import { receivedInSgt } from './paradeMessages.js';

/** @type {number} The longest text any one answer may be; FormSG answers are far shorter. */
export const MAX_TEXT_CHARS = 200;

/** @type {number} Singapore is UTC+8 all year, with no daylight saving. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * The free-text answers a clerk may correct, with the label each is shown under.
 * @type {!Array<{key: string, label: string}>}
 */
export const TEXT_FIELDS = [
  { key: 'rank', label: 'Rank' },
  { key: 'name', label: 'Name' },
  { key: 'groupIc', label: 'Group IC' },
  { key: 'pesStatus', label: 'PES status' },
  { key: 'exercises', label: 'Exercises (separate with ;)' },
  { key: 'sfabtType', label: 'SFABT type' },
  { key: 'location', label: 'Training location' },
];

/**
 * The two acknowledgement ticks, with the label each is shown under.
 * @type {!Array<{key: string, label: string}>}
 */
export const ACKNOWLEDGEMENTS = [
  { key: 'informedCommander', label: 'Informed commander' },
  { key: 'windowConfirmed', label: 'Training between 0700h and 2200h' },
];

/** @type {!RegExp} A `datetime-local` value: `YYYY-MM-DDTHH:MM`. */
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/**
 * Reads a Singapore-local `YYYY-MM-DDTHH:MM` as an instant.
 * @param {*} value The form's date-and-time value.
 * @returns {?number} Milliseconds since the epoch, or null when it is not a real time.
 */
function sgtInstant(value) {
  const match = typeof value === 'string' ? LOCAL_TIME.exec(value) : null;
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  const utc = Date.UTC(year, month - 1, day, hour, minute);
  const back = new Date(utc);
  // Date.UTC rolls 30 Feb over into March; a real date survives the round trip.
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day || hour > 23 || minute > 59) return null;
  return utc - SGT_OFFSET_MS;
}

/**
 * Checks one free-text answer.
 * @param {*} value The form's value.
 * @param {boolean} required Whether a blank is refused.
 * @returns {{value: ?string}|{error: string}} The trimmed text (null when blank), or why not.
 */
function checkText(value, required) {
  if (value !== null && value !== undefined && typeof value !== 'string') return { error: 'Must be text.' };
  const text = (value || '').trim();
  if (text.length > MAX_TEXT_CHARS) return { error: `At most ${MAX_TEXT_CHARS} characters.` };
  if (!text && required) return { error: 'Required.' };
  return { value: text || null };
}

/**
 * Checks the company, which must be one the battalion tracks, or blank.
 * @param {*} value The form's value.
 * @returns {{value: ?string}|{error: string}} The company (null when blank), or why not.
 */
function checkCompany(value) {
  if (value === null || value === undefined || value === '') return { value: null };
  return COMPANIES.includes(value) ? { value } : { error: 'Pick one of the companies.' };
}

/**
 * Checks the submission time: a real Singapore time, not in the future.
 * @param {*} value The form's `YYYY-MM-DDTHH:MM`.
 * @param {number} now Milliseconds since the epoch.
 * @returns {{value: string}|{error: string}} The ISO instant, or why not.
 */
function checkTime(value, now) {
  const instant = sgtInstant(value);
  if (instant === null) return { error: 'Enter a date and time.' };
  if (instant > now) return { error: 'Cannot be in the future.' };
  return { value: new Date(instant).toISOString() };
}

/**
 * Checks one acknowledgement tick.
 * @param {*} value The form's value.
 * @returns {{value: boolean}|{error: string}} The tick, or why not.
 */
function checkTick(value) {
  return typeof value === 'boolean' ? { value } : { error: 'Must be ticked or not.' };
}

/**
 * Checks a correction and turns it into the columns to write.
 *
 * `nameKey`, `unitCoy` and `sftDate` are not here: the server derives them from these, as the
 * webhook does on insert.
 * @param {*} form The form: every `TEXT_FIELDS` key, `company`, `submittedAt`
 *     (Singapore `YYYY-MM-DDTHH:MM`) and every `ACKNOWLEDGEMENTS` key.
 * @param {number} now Milliseconds since the epoch, so the future can be refused.
 * @returns {{ok: true, value: !Object<string, *>}|{ok: false, errors: !Object<string, string>}} The
 *     columns to write, or each field's problem.
 */
export function validateSftEdit(form, now) {
  if (!form || typeof form !== 'object') return { ok: false, errors: { form: 'Nothing to save.' } };
  const checks = {
    ...Object.fromEntries(TEXT_FIELDS.map(({ key }) => [key, checkText(form[key], key === 'name')])),
    company: checkCompany(form.company),
    timestamp: checkTime(form.submittedAt, now),
    ...Object.fromEntries(ACKNOWLEDGEMENTS.map(({ key }) => [key, checkTick(form[key])])),
  };
  const errors = {};
  const value = {};
  for (const [key, check] of Object.entries(checks)) {
    // The form names the time `submittedAt`; the column is `timestamp`.
    if ('error' in check) errors[key === 'timestamp' ? 'submittedAt' : key] = check.error;
    else value[key] = check.value;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/**
 * The editor's starting values for a stored record.
 * @param {!Object} record One record from `GET /api/sft`.
 * @returns {!Object} The form, in the shape `validateSftEdit` reads.
 */
export function toEditForm(record) {
  const sgt = receivedInSgt(record.timestamp);
  return {
    ...Object.fromEntries(TEXT_FIELDS.map(({ key }) => [key, record[key] || ''])),
    company: record.company || '',
    submittedAt: sgt ? `${sgt.date}T${sgt.time}` : '',
    ...Object.fromEntries(ACKNOWLEDGEMENTS.map(({ key }) => [key, record[key] === true])),
  };
}

/**
 * Shapes the stored records for the table, newest first as the API returns them.
 * @param {!Array<!Object>} records Records from `GET /api/sft`.
 * @returns {!Array<{id: string, date: string, time: string, who: string, company: string,
 *     groupIc: string, location: string, search: string}>} One row per record.
 */
export function toSftRows(records) {
  return records.map((record) => {
    const sgt = receivedInSgt(record.timestamp);
    const who = [record.rank, record.name].filter(Boolean).join(' ') || '—';
    const row = {
      id: record.responseId,
      date: record.sftDate,
      time: sgt ? sgt.time : '',
      who,
      company: record.company || '—',
      groupIc: record.groupIc || '—',
      location: record.location || '—',
    };
    return { ...row, search: [who, row.company, row.groupIc, row.location].join(' ').toLowerCase() };
  });
}

/**
 * Keeps the rows whose name, company, Group IC or location contain the query.
 * @param {!Array<{search: string}>} rows Rows from `toSftRows`.
 * @param {string} query What the clerk typed; blank keeps every row.
 * @returns {!Array<!Object>} The matching rows, in their order.
 */
export function filterSftRows(rows, query) {
  const needle = query.trim().toLowerCase();
  return needle ? rows.filter((row) => row.search.includes(needle)) : rows;
}
