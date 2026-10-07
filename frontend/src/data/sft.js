/**
 * The Deposit page's calls to `/api/sft`, through `api.js#callJson`.
 *
 * FormSG is the only way an SFT record is created, so there is no deposit here: only the
 * list, a correction and a delete.
 */

import { callJson } from './api.js';

/** @type {string} The SFT route, served by the same Vercel deployment as this page. */
const API = '/api/sft';

/**
 * What each non-JSON failure means to the person at the screen.
 * @type {!Object<number, string>}
 */
const HTTP_ERRORS = {
  401: 'The session has ended. Reload the page and unlock it again.',
  404: 'That SFT record no longer exists. Reload the list.',
  503: 'SFT corrections are not configured yet. Set DASHBOARD_PASSWORD on Vercel.',
};

/**
 * Lists every SFT record, newest first.
 * @returns {!Promise<!Array<!Object>>} The records.
 */
export async function listSftRecords() {
  return (await callJson(API, 'GET', '', undefined, HTTP_ERRORS)).records || [];
}

/**
 * Replaces a record's answers with a correction.
 * @param {string} id The record's FormSG response id.
 * @param {!Object} form The correction, in the shape `model/sftEdit.js#validateSftEdit` reads.
 * @returns {!Promise<!Object>} `{status: 'updated', record}`, or a 422's `{error, errors}`.
 */
export function updateSftRecord(id, form) {
  return callJson(API, 'PUT', '?id=' + encodeURIComponent(id), form, HTTP_ERRORS);
}

/**
 * Deletes a record.
 * @param {string} id The record's FormSG response id.
 * @returns {!Promise<!Object>} The acknowledgement.
 */
export function deleteSftRecord(id) {
  return callJson(API, 'DELETE', '?id=' + encodeURIComponent(id), undefined, HTTP_ERRORS);
}
