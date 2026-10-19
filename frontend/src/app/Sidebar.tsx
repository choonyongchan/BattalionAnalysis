/**
 * The left rail: brand, pages and the session controls. A rail rather than tabs, so the medical pages a
 * commander compares stay in view together.
 */

import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Link, useRoute } from 'wouter-preact';
import { dataset } from './state.ts';
import { Logo } from './Logo.tsx';
import { LockIcon, MoonIcon, SunIcon, SystemThemeIcon } from './icons.tsx';
import { DEFAULT_ROUTE, navGroups, type PageRoute } from './routes.ts';
import { lock } from './auth.ts';
import { cycleTheme, resolvedTheme, themeChoice, type ThemeChoice } from '../theme/useTheme.ts';
import { unitSettings } from '../data/settings.ts';

/** How each theme setting reads. */
const THEME_LABELS: Record<ThemeChoice, { icon: ComponentType; label: string }> = {
  system: { icon: SystemThemeIcon, label: 'Theme: match the system' },
  light: { icon: SunIcon, label: 'Theme: light' },
  dark: { icon: MoonIcon, label: 'Theme: dark' },
};

/** One navigation entry, marked current when its route is open. */
function NavLink({ route, onNavigate }: { route: PageRoute; onNavigate: () => void }) {
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

/** How long ago, in the coarsest unit that reads naturally: "just now", "5 min ago", "3 h ago". */
function ago(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? hours + ' h ago' : Math.floor(hours / 24) + ' d ago';
}

/** When the data was last fetched, re-read every minute; nothing before the first load. */
function SyncStatus() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const stamp = dataset.value?.generatedAt;
  const at = stamp ? new Date(stamp) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return (
    <p class="sidebar__sync" title={'Last synced ' + at.toLocaleString()}>
      Synced {ago(Math.max(0, now - at.getTime()))}
    </p>
  );
}

/** The rail; `open` shows the slide-over on narrow screens, `onNavigate` runs after a link is followed. */
export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const theme = THEME_LABELS[themeChoice.value];
  const ThemeIcon = theme.icon;

  return (
    <nav class="sidebar" data-open={String(open)} aria-label="Dashboard sections">
      <Link class="sidebar__brand" href={DEFAULT_ROUTE} onClick={onNavigate}>
        <Logo size={44} />
        <span>
          <span class="sidebar__wordmark">{unitSettings().name}</span>
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

      <SyncStatus />

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
