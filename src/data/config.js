/**
 * Deployment settings for the dashboard.
 *
 * Nothing here is a secret, and nothing here needs to be. The feed URL names an endpoint
 * that refuses to answer without the password, and the password is never in this file,
 * this repo, or this page — it lives in the `DASHBOARD_PASSWORD` script property on the
 * Apps Script side, is typed by the viewer, and is checked where the viewer cannot see or
 * skip the check.
 *
 * Setting FEED_URL is the one edit needed before the dashboard works; see
 * `dashboard/README.md`.
 */

/**
 * The deployed Apps Script web app, with the dashboard route.
 *
 * The same `/exec` URL that already receives parade states and report-sick submissions,
 * with `?route=dashboard` appended — one deployment, three routes. See `src/WebApp.js`.
 * @type {string}
 */
export const FEED_URL =
  'https://script.google.com/macros/s/AKfycbz8_zMmzsdpfX2C0FHJNV7xqwupy1AbPaeoi8TQU_FHhLazYA8T1ozqctx7lisDjJda/exec?route=dashboard';

/** 
 * Where the spreadsheet itself lives, for the "edit in Sheets" links on Settings.
 *
 * Empty when unknown: Settings then names the tab and its headers instead of linking.
 * @type {string}
 */
export const SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/19V3KpnCFmKMrXH4qrYtKzT7deK5jf4qniscZbKzJNF4';
