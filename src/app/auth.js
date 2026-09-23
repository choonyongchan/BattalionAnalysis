/**
 * The session's whole life, from the password typed to the session ended.
 *
 * This file holds no credential. The password is sent once, to `/api/session`, which
 * answers with an `HttpOnly` session cookie the browser stores and no script here — or
 * injected into this page — can read. Every later call simply carries that cookie.
 *
 * A reload therefore does not ask again: the cookie is still there, and `resume()` finds
 * out by trying to read. The session lasts twelve hours, ends at once when **Lock** is
 * pressed, and stops verifying the moment `DASHBOARD_PASSWORD` is rotated, because the
 * token is signed with it (`lib/session.ts`).
 *
 * There is no password check in this file, and there must not be one. The check happens in
 * `api/session.ts`, where the caller cannot see or skip it. A check here would be decoration.
 */

import { loadAll } from '../data/feed.js';
import { endSession, startSession } from '../data/session.js';
import { dataset, loadError, status } from './state.js';

/** @type {number} How often an open dashboard re-reads Neon, in milliseconds. */
const REFRESH_MS = 60 * 1000;

/**
 * Deletes the password a previous build of this page kept in `localStorage`.
 *
 * That build is gone, but a browser that ran it is still holding the password until
 * something removes it, and that something has to be this page.
 * @returns {void}
 */
function forgetStoredPassword_() {
  try {
    window.localStorage.removeItem('bda.dashboardPassword');
  } catch {
    // Storage can be blocked outright; there is then nothing left behind to remove.
  }
}

forgetStoredPassword_();

/** @type {boolean} Whether a background refresh is already waiting on the server. */
let refreshing = false;

/**
 * Opens the dashboard with the password the viewer typed.
 *
 * The password goes to the server and is not kept here, so a failed attempt leaves nothing
 * behind and the next one types it again.
 * @param {string} typed The password from the login form.
 * @returns {!Promise<boolean>} True once data is loaded.
 */
export function unlock(typed) {
  if (typed === '') {
    loadError.value = 'Enter the password.';
    return Promise.resolve(false);
  }
  loadError.value = '';
  status.value = 'loading';
  return startSession(typed)
    .then(() => read_())
    .catch((error) => fail_(error));
}

/**
 * Opens the dashboard on the session from an earlier visit, if the browser still has one.
 *
 * Called once at start-up. There is no way to ask whether the cookie is there — it is
 * `HttpOnly` — so this reads, and a 401 simply means the login screen stays up.
 * @returns {!Promise<boolean>} True once data is loaded.
 */
export function resume() {
  status.value = 'loading';
  return read_().catch((error) => fail_(error));
}

/**
 * Reads the dataset and moves the store to 'ready'.
 * @returns {!Promise<boolean>} True once data is loaded.
 */
function read_() {
  return loadAll().then((data) => {
    dataset.value = data;
    loadError.value = '';
    status.value = 'ready';
    return true;
  });
}

/**
 * Puts the login screen back up with the reason on it.
 * @param {!Error} error What went wrong.
 * @returns {boolean} False, so callers can return it.
 */
function fail_(error) {
  loadError.value = error.message;
  status.value = 'locked';
  return false;
}

/**
 * Re-reads the data in the background, leaving the page on screen while it waits.
 *
 * Only an ended session changes what the viewer sees: the login screen returns. Any other
 * failure keeps the data already drawn and waits for the next tick, since a dropped
 * connection is not a reason to take the page away.
 * @returns {!Promise<boolean>} True when fresh data replaced the old.
 */
export function refresh() {
  if (refreshing) {
    return Promise.resolve(false);
  }
  refreshing = true;
  return loadAll()
    .then((data) => {
      dataset.value = data;
      return true;
    })
    .catch((error) => {
      if (error.status === 401) {
        fail_(error);
      }
      return false;
    })
    .finally(() => {
      refreshing = false;
    });
}

/**
 * Keeps an open dashboard current: re-reads every minute while the tab is visible, and at
 * once when a hidden tab is shown again.
 *
 * A hidden tab does not poll, so a dashboard left open overnight in a background tab costs
 * no reads until someone looks at it.
 * @returns {function(): void} Stops the refreshing.
 */
export function startAutoRefresh() {
  const timer = window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      refresh();
    }
  }, REFRESH_MS);
  /**
   * Refreshes when the tab comes back into view.
   * @returns {void}
   */
  function onVisible() {
    if (document.visibilityState === 'visible') {
      refresh();
    }
  }
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/**
 * Ends the session at the server, then reloads to forget everything read with it.
 *
 * The reload is not the security boundary — deleting the cookie is — but it is the most
 * complete way to clear the data already on screen.
 * @returns {void}
 */
export function lock() {
  endSession().finally(() => window.location.reload());
}
