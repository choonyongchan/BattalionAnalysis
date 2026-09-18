/**
 * The shell's icon set.
 *
 * Hand-drawn rather than pulled from a library: seven nav icons and four controls is not
 * worth a dependency, and drawing them here keeps every one on the same 24-unit grid at
 * the same 1.6 stroke, which is what makes an icon rail look deliberate rather than
 * assembled. All inherit `currentColor`, so the active-link and theme colours reach them
 * without a second definition.
 *
 * Each icon is named for what it points at, in the unit's own words.
 */

/**
 * Wraps a path set in the shared 24-unit stroked frame.
 * @param {{children: *, size?: number}} props The paths, and an optional pixel size.
 * @returns {!preact.VNode} The icon.
 */
function Glyph({ children, size = 18 }) {
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

/** @returns {!preact.VNode} Bars rising left to right: the battalion at a glance. */
export const OverviewIcon = () => (
  <Glyph>
    <path d="M4 20V13M10 20V7M16 20V10M22 20H2" />
  </Glyph>
);

/** @returns {!preact.VNode} A medical cross in a rounded square: reporting sick. */
export const ReportSickIcon = () => (
  <Glyph>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Glyph>
);

/** @returns {!preact.VNode} A certificate page: MC and medical appointments. */
export const McMaIcon = () => (
  <Glyph>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9.5 13.5l1.8 1.8 3.2-3.6" />
  </Glyph>
);

/** @returns {!preact.VNode} A shield with a bar through it: present, with limits. */
export const StatusIcon = () => (
  <Glyph>
    <path d="M12 3l7 2.6v5.1c0 4.1-2.8 7.5-7 8.9-4.2-1.4-7-4.8-7-8.9V5.6Z" />
    <path d="M8.8 12.2h6.4" />
  </Glyph>
);

/** @returns {!preact.VNode} One person: the soldier lookup. */
export const SoldierIcon = () => (
  <Glyph>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </Glyph>
);

/** @returns {!preact.VNode} A command tree: who is on duty. */
export const OrbatIcon = () => (
  <Glyph>
    <rect x="9" y="2.8" width="6" height="4.4" rx="1.2" />
    <rect x="2.5" y="16.8" width="6" height="4.4" rx="1.2" />
    <rect x="15.5" y="16.8" width="6" height="4.4" rx="1.2" />
    <path d="M12 7.2v4.4M5.5 16.8v-2.6h13v2.6" />
  </Glyph>
);

/** @returns {!preact.VNode} Sliders: the settings the dashboard reads. */
export const SettingsIcon = () => (
  <Glyph>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="10" cy="17" r="2.2" />
  </Glyph>
);

/** @returns {!preact.VNode} A closed padlock: end the session. */
export const LockIcon = () => (
  <Glyph size={16}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
    <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
  </Glyph>
);

/** @returns {!preact.VNode} Three stacked rules: open the navigation. */
export const MenuIcon = () => (
  <Glyph>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Glyph>
);

/** @returns {!preact.VNode} A sun: the light theme. */
export const SunIcon = () => (
  <Glyph size={16}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </Glyph>
);

/** @returns {!preact.VNode} A crescent: the dark theme. */
export const MoonIcon = () => (
  <Glyph size={16}>
    <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
  </Glyph>
);

/** @returns {!preact.VNode} A half-filled circle: follow the machine. */
export const SystemThemeIcon = () => (
  <Glyph size={16}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none" />
  </Glyph>
);
