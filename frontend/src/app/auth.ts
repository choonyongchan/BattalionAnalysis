/**
 * The session's whole life. No credential lives here: the password goes once to `/api/session` for an
 * `HttpOnly` cookie, and the server checks it, where the page cannot see or skip the check.
 */

import { loadAll } from '../data/feed.ts';
import { ApiError } from '../data/api.ts';
import { refreshMs } from '../data/settings.ts';
import { endSession, startSession } from '../data/session.ts';
import { dataset, loadError, status } from './state.ts';

/**
 * Deletes the password an earlier build kept in `localStorage`.
 * ponytail: one-off purge kept on purpose; delete once every clerk browser has loaded a
 * build since 2026-09-21 (safe after 2026-12-31).
 */
function forgetStoredPassword(): void {
  try {
    window.localStorage.removeItem('bda.dashboardPassword');
  } catch {
    // Storage can be blocked outright; then there is nothing to remove.
  }
}

forgetStoredPassword();

/** The background read waiting on the server, if any. */
let inFlight: Promise<boolean> | null = null;

/** The one follow-up read queued behind `inFlight`, if any. */
let queued: Promise<boolean> | null = null;

/** Reads the dataset and moves to 'ready'. */
async function read(): Promise<boolean> {
  dataset.value = await loadAll();
  loadError.value = '';
  status.value = 'ready';
  return true;
}

/** Puts the login screen back up with the reason on it. */
function fail(error: unknown): false {
  loadError.value = error instanceof Error ? error.message : String(error);
  status.value = 'locked';
  return false;
}

/** Opens the dashboard with the typed password (sent, never kept). */
export function unlock(typed: string): Promise<boolean> {
  if (typed === '') {
    loadError.value = 'Enter the password.';
    return Promise.resolve(false);
  }
  loadError.value = '';
  status.value = 'loading';
  return startSession(typed).then(read).catch(fail);
}

/** Opens on an earlier visit's cookie if the browser still has one (a 401 keeps the login screen up). */
export function resume(): Promise<boolean> {
  status.value = 'loading';
  return read().catch(fail);
}

/** One background read: replaces the dataset, or returns to the login screen when the session has ended. */
async function readInBackground(): Promise<boolean> {
  try {
    dataset.value = await loadAll();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) fail(error);
    return false;
  }
}

/**
 * Re-reads in the background; only one read runs at once, and a call made mid-read queues one follow-up
 * (the caller may have just saved something the running read began too early to see).
 */
export function refresh(): Promise<boolean> {
  if (queued) return queued;
  if (inFlight) {
    queued = inFlight.then(() => {
      queued = null;
      return refresh();
    });
    return queued;
  }
  inFlight = readInBackground().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Re-reads at the Session interval while the tab is visible, and at once when it is shown again; returns a stop. */
export function startAutoRefresh(): () => void {
  let timer = 0;
  const refreshIfVisible = () => {
    if (document.visibilityState === 'visible') void refresh();
  };
  const tick = () => {
    refreshIfVisible();
    timer = window.setTimeout(tick, refreshMs());
  };
  timer = window.setTimeout(tick, refreshMs());
  document.addEventListener('visibilitychange', refreshIfVisible);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', refreshIfVisible);
  };
}

/** Ends the session at the server, then reloads to forget everything on screen. */
export function lock(): void {
  void endSession().finally(() => window.location.reload());
}
