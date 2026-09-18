/**
 * The left rail: brand, the seven pages, and the two session controls.
 *
 * It is a rail rather than a top tab strip because the three medical pages are read
 * against each other — a commander looks at report sick, then MC, then status, comparing
 * as they go — and a vertical list keeps all three in view while one is open.
 */

import { Link, useRoute } from 'wouter-preact';
import { Logo } from './Logo.jsx';
import { LockIcon, MoonIcon, SunIcon, SystemThemeIcon } from './icons.jsx';
import { navGroups } from './routes.js';
import { lock } from './auth.js';
import { cycleTheme, resolvedTheme, themeChoice } from '../theme/useTheme.js';

/** @type {!Object<string, {icon: function, label: string}>} How each theme setting reads. */
const THEME_LABELS = {
  system: { icon: SystemThemeIcon, label: 'Theme: match the system' },
  light: { icon: SunIcon, label: 'Theme: light' },
  dark: { icon: MoonIcon, label: 'Theme: dark' },
};

/**
 * One navigation entry, marked current when its route is open.
 * @param {{route: !Object, onNavigate: function(): void}} props The route, and what to do after.
 * @returns {!preact.VNode} The link.
 */
function NavLink({ route, onNavigate }) {
  const [isActive] = useRoute(route.path);
  const Icon = route.icon;
  return (
    <Link
      class="navlink"
      href={route.path}
      aria-current={isActive ? 'page' : undefined}
      onClick={onNavigate}
    >
      <Icon />
      <span>{route.label}</span>
    </Link>
  );
}

/**
 * Renders the sidebar.
 * @param {{open: boolean, onNavigate: function(): void}} props Whether the slide-over is
 *     showing on narrow screens, and what to call once a link is followed.
 * @returns {!preact.VNode} The rail.
 */
export function Sidebar({ open, onNavigate }) {
  const theme = THEME_LABELS[themeChoice.value];
  const ThemeIcon = theme.icon;

  return (
    <nav class="sidebar" data-open={String(open)} aria-label="Dashboard sections">
      <Link class="sidebar__brand" href="/overview" onClick={onNavigate}>
        <Logo size={44} />
        <span>
          <span class="sidebar__wordmark">40 SAR</span>
          <span class="sidebar__unit">Personnel</span>
        </span>
      </Link>

      <div class="sidebar__nav">
        {navGroups().map((group) => (
          <div class="navgroup" key={group.name || 'ungrouped'}>
            {group.name ? <p class="navgroup__label">{group.name}</p> : null}
            {group.routes.map((route) => (
              <NavLink key={route.path} route={route} onNavigate={onNavigate} />
            ))}
          </div>
        ))}
      </div>

      <div class="sidebar__foot">
        <button
          class="button button--quiet"
          type="button"
          onClick={cycleTheme}
          aria-label={theme.label}
          title={theme.label}
        >
          <ThemeIcon />
          <span class="visually-hidden">
            {theme.label} — currently showing {resolvedTheme.value}
          </span>
        </button>
        <button class="button button--quiet" type="button" onClick={lock}>
          <LockIcon />
          <span>Lock</span>
        </button>
      </div>
    </nav>
  );
}
