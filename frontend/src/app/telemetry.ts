/**
 * Vercel Web Analytics and Speed Insights, keyed by page.
 *
 * The dashboard routes on the hash (`#/soldier`), which neither script reads: left alone,
 * every page would be counted as `/`. So automatic tracking is off, each page change is
 * reported by `trackPage`, and every event's URL is rewritten to the page's path first.
 * The rewrite also drops any query, so nothing but a page name leaves the browser.
 */

import { inject, pageview } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

/** @type {?{setRoute: function(?string): void}} The Speed Insights handle, once started. */
let speedInsights = null;

/**
 * Rewrites a hash-routed URL to one whose path is the page.
 * @param {string} href The URL as the browser has it, e.g. `https://host/#/soldier?q=x`.
 * @returns {string} The URL with the hash route as its path, e.g. `https://host/soldier`.
 */
export function routeUrl(href) {
  const url = new URL(href);
  const path = url.hash.slice(1).split('?')[0];
  return url.origin + (path.startsWith('/') ? path : '/');
}

/**
 * Rewrites an outgoing event's URL through `routeUrl`.
 * @param {{url: string}} event The event either script is about to send.
 * @returns {{url: string}} The same event with its URL rewritten.
 */
function rewrite(event) {
  return { ...event, url: routeUrl(event.url) };
}

/** Injects both scripts. Call once, before the first render. */
export function startTelemetry() {
  inject({ disableAutoTrack: true, beforeSend: rewrite });
  speedInsights = injectSpeedInsights({ beforeSend: rewrite });
}

/**
 * Reports one page view and tags later Web Vitals with the page.
 * @param {string} path The route path, e.g. `/soldier`.
 */
export function trackPage(path) {
  pageview({ route: path, path });
  speedInsights?.setRoute(path);
}
