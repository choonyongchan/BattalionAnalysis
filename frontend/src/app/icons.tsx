/**
 * The shell's hand-drawn icons, all on one 24-unit grid at a 1.6 stroke (a dozen icons is not worth a
 * dependency). They inherit `currentColor`, so theme and active-link colours reach them.
 */

import type { ComponentChildren } from 'preact';

/** The shared 24-unit stroked frame around an icon's paths. */
function Glyph({ children, size = 18 }: { children: ComponentChildren; size?: number }) {
  return (
    <svg
      class="navlink__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Bars rising left to right: the battalion at a glance. */
export const OverviewIcon = () => (
  <Glyph>
    <path d="M4 20V13M10 20V7M16 20V10M22 20H2" />
  </Glyph>
);

/** A line rising across an axis: the battalion over time. */
export const TrendsIcon = () => (
  <Glyph>
    <path d="M3 20h18M4 16l5-5 4 3 7-8" />
  </Glyph>
);

/** A clipboard with a tick: parade states filed and checked. */
export const FilingIcon = () => (
  <Glyph>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3h6v1.5M9 13l2 2 4-4" />
  </Glyph>
);

/** A dumbbell: self-regulated fitness training. */
export const SftIcon = () => (
  <Glyph>
    <path d="M8 12h8M5 8v8M8 6v12M16 6v12M19 8v8" />
  </Glyph>
);

/** A medical cross in a rounded square: reporting sick. */
export const ReportSickIcon = () => (
  <Glyph>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Glyph>
);

/** A certificate page: MC and medical appointments. */
export const McMaIcon = () => (
  <Glyph>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9.5 13.5l1.8 1.8 3.2-3.6" />
  </Glyph>
);

/** A shield with a bar through it: present, with limits. */
export const StatusIcon = () => (
  <Glyph>
    <path d="M12 3l7 2.6v5.1c0 4.1-2.8 7.5-7 8.9-4.2-1.4-7-4.8-7-8.9V5.6Z" />
    <path d="M8.8 12.2h6.4" />
  </Glyph>
);

/** One person: the soldier lookup. */
export const SoldierIcon = () => (
  <Glyph>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Glyph>
);

/** A command tree: who is on duty. */
export const DutyRosterIcon = () => (
  <Glyph>
    <rect x="9" y="2.8" width="6" height="4.4" rx="1.2" />
    <rect x="2.5" y="16.8" width="6" height="4.4" rx="1.2" />
    <rect x="15.5" y="16.8" width="6" height="4.4" rx="1.2" />
    <path d="M12 7.2v4.4M5.5 16.8v-2.6h13v2.6" />
  </Glyph>
);

/** Sliders: the settings the dashboard reads. */
export const SettingsIcon = () => (
  <Glyph>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="10" cy="17" r="2.2" />
  </Glyph>
);

/** A closed padlock: end the session. */
export const LockIcon = () => (
  <Glyph size={16}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </Glyph>
);

/** A clipboard with lines: a parade state to file or correct. */
export const DepositIcon = () => (
  <Glyph>
    <path d="M9 4h6v3H9zM9 5.5H6.5A1.5 1.5 0 0 0 5 7v12.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V7a1.5 1.5 0 0 0-1.5-1.5H15M8.5 11.5h7M8.5 15h7M8.5 18.5h4" />
  </Glyph>
);

/** A magnifying glass: search. */
export const SearchIcon = () => (
  <Glyph>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.3 15.3 20.5 20.5" />
  </Glyph>
);

/** A cross: clear what was typed. */
export const ClearIcon = () => (
  <Glyph>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Glyph>
);

/** Three stacked rules: open the navigation. */
export const MenuIcon = () => (
  <Glyph>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Glyph>
);

/** A sun: the light theme. */
export const SunIcon = () => (
  <Glyph size={16}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </Glyph>
);

/** A crescent: the dark theme. */
export const MoonIcon = () => (
  <Glyph size={16}>
    <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
  </Glyph>
);

/** A half-filled circle: follow the machine. */
export const SystemThemeIcon = () => (
  <Glyph size={16}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none" />
  </Glyph>
);
