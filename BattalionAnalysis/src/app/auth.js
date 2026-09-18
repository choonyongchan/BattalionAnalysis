/**
 * The password's whole life, from typed to forgotten.
 *
 * It is held in one module-scoped variable and never written to `localStorage`,
 * `sessionStorage`, or a cookie. Locking reloads the page, which is the most complete way
 * to forget it: the variable goes with the document. A failed attempt discards it too, so
 * a wrong password is not left sitting in memory waiting to be retried by something else.
 *
 * There is no password check in this file, and there must not be one. The check happens
 * in `src/dashboard/DashboardFeed.js`, where the caller cannot see or skip it. A check
 * here would be decoration.
 */

import { loadAll } from '../data/feed.js';
import { dataset, loadError, reset, status } from './state.js';

/** @type {string} The password the viewer typed, for this tab only. */
let password = '';

/**
 * Attempts to unlock the dashboard with a password.
 *
 * On failure the password is discarded rather than kept for a retry — the next attempt
 * types it again.
 * @param {string} typed The password from the login form.
 * @returns {!Promise<boolean>} True once data is loaded.
 */
export function unlock(typed) {
  if (typed === '') {
    loadError.value = 'Enter the password.';
    return Promise.resolve(false);
  }
  password = typed;
  loadError.value = '';
  return load_('locked', true);
}

/**
 * Re-reads the spreadsheet with the password already held.
 * @returns {!Promise<boolean>} True once fresh data is loaded.
 */
export function refresh() {
  return password === '' ? Promise.resolve(false) : load_('error', false);
}

/**
 * Loads the dataset with the held password and moves the store to its next state.
 *
 * The two callers differ only in what a failure means. A wrong password on the login
 * screen is 'locked' — the viewer is where they started, and the password is discarded so
 * it is not left in memory to be retried by something else. A failure while already
 * unlocked is 'error': the password was right, the network or the feed was not, and
 * throwing the viewer back to the login screen would lose the data they still have.
 * @param {string} failStatus Status to fall to when the load fails.
 * @param {boolean} forgetOnFail Whether a failure discards the held password.
 * @returns {!Promise<boolean>} True once data is loaded.
 */
function load_(failStatus, forgetOnFail) {
  status.value = 'loading';
  return loadAll(password)
    .then((data) => {
      dataset.value = data;
      status.value = 'ready';
      return true;
    })
    .catch((error) => {
      if (forgetOnFail) {
        password = '';
      }
      loadError.value = error.message;
      status.value = failStatus;
      return false;
    });
}

/**
 * Forgets the password and everything loaded with it.
 * @returns {void}
 */
export function lock() {
  password = '';
  reset();
  window.location.reload();
}
