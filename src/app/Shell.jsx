/**
 * The frame every page renders inside.
 *
 * It owns three things and no data: whether the narrow-screen rail is open, the page
 * heading, and the skip link. Pages receive nothing from it — they read `state.js`
 * directly — so a page can be opened, read and tested without the frame around it.
 */

import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'wouter-preact';
import { Sidebar } from './Sidebar.jsx';
import { Logo } from './Logo.jsx';
import { MenuIcon } from './icons.jsx';
import { routeAt } from './routes.js';

/**
 * Renders the sidebar, the top bar shown on narrow screens, and the content column.
 * @param {{children: *}} props The open page.
 * @returns {!preact.VNode} The shell.
 */
export function Shell({ children }) {
  const [location] = useLocation();
  const [railOpen, setRailOpen] = useState(false);
  const route = routeAt(location);

  // A page change closes the rail: on a phone the slide-over covers what was just
  // navigated to, and leaving it open would hide the answer the tap asked for.
  useEffect(() => {
    setRailOpen(false);
  }, [location]);

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
          <span class="sidebar__wordmark">{route ? route.label : '40 SAR'}</span>
        </div>

        <main class="content" id="view" tabIndex={-1}>
          <div class="content__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}
