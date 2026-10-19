/**
 * The frame every page renders in. It owns the narrow-screen rail, the heading, the skip link and the
 * background refresh; pages read `state.ts` directly, so each can be rendered without it.
 */

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { Sidebar } from './Sidebar.tsx';
import { Logo } from './Logo.tsx';
import { MenuIcon } from './icons.tsx';
import { routeAt } from './routes.ts';
import { startAutoRefresh } from './auth.ts';
import { trackPage } from './telemetry.ts';
import { dataset } from './state.ts';
import { unitSettings } from '../data/settings.ts';

/** The sidebar, the narrow-screen top bar and the content column. */
export function Shell({ children }: { children: ComponentChildren }) {
  const [location] = useLocation();
  const [railOpen, setRailOpen] = useState(false);
  const route = routeAt(location);

  // A page change closes the rail: on a phone the slide-over covers what was just
  // navigated to, and leaving it open would hide the answer the tap asked for.
  useEffect(() => {
    setRailOpen(false);
    trackPage(location);
  }, [location]);

  // The shell exists only while the dashboard is unlocked, so it owns the polling.
  useEffect(() => startAutoRefresh(), []);

  const pageTitle = dataset.value ? unitSettings().pageTitle : '';
  useEffect(() => {
    if (pageTitle) document.title = pageTitle;
  }, [pageTitle]);

  return (
    <div class="shell">
      <a class="skip-link" href="#view">
        Skip to content
      </a>

      <Sidebar open={railOpen} onNavigate={() => setRailOpen(false)} />

      {railOpen ? (
        <button
          class="sidebar__scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setRailOpen(false)}
        />
      ) : null}

      <div>
        <div class="topbar">
          <button
            class="button button--quiet sidebar__toggle"
            type="button"
            aria-expanded={railOpen}
            aria-label="Open navigation"
            onClick={() => setRailOpen(true)}
          >
            <MenuIcon />
          </button>
          <Logo size={22} />
          <span class="sidebar__wordmark">{route ? route.label : unitSettings().name}</span>
        </div>

        <main class="content" id="view" tabIndex={-1}>
          <div class="content__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
