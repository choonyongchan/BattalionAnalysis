/**
 * Vercel Web Analytics and Speed Insights, keyed by page. Neither reads the hash route, so every event's
 * URL is rewritten to the page path first, which also drops any query: only a page name leaves the browser.
 */

import { inject, pageview } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

/** The Speed Insights handle, once started. */
let speedInsights: ReturnType<typeof injectSpeedInsights> = null;

/** A hash-routed URL with the route as its path: `https://host/#/soldier?q=x` is `https://host/soldier`. */
export function routeUrl(href: string): string {
  const url = new URL(href);
  const path = url.hash.slice(1).split('?')[0] ?? '';
  return url.origin + (path.startsWith('/') ? path : '/');
}

/** An outgoing event with its URL rewritten through `routeUrl`. */
function rewrite<E extends { url: string }>(event: E): E {
  return { ...event, url: routeUrl(event.url) };
}

/** Injects both scripts; call once, before the first render. */
export function startTelemetry(): void {
  inject({ disableAutoTrack: true, beforeSend: rewrite });
  speedInsights = injectSpeedInsights({ beforeSend: rewrite });
}

/** Reports one page view, e.g. `/soldier`, and tags later Web Vitals with the page. */
export function trackPage(path: string): void {
  pageview({ route: path, path });
  speedInsights?.setRoute(path);
}
