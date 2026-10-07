/**
 * Light, dark, or whatever the machine is set to.
 *
 * The stored value is a preference, not a colour: "system" stays system, so a viewer who
 * never chose keeps following their machine when it flips at sunset. Only an explicit
 * choice writes `data-theme`, which is what lets the CSS resolve all three states.
 *
 * `resolved` is what is actually on screen. Charts subscribe to it rather than to the
 * preference, because "system" tells them nothing about which palette to read.
 */

import { signal, computed, effect } from '@preact/signals';

/** @type {string} Where the viewer's choice is remembered. */
const STORAGE_KEY = 'dashboard-theme';

/** @type {string[]} The three settings a viewer can hold. */
const THEME_CHOICES = ['system', 'light', 'dark'];

/**
 * Reads the stored preference.
 *
 * Storage throws in a private window and in a browser set to block site data, so a
 * failure here means "no preference", never a broken page.
 * @returns {string} One of THEME_CHOICES.
 */
function storedChoice() {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return THEME_CHOICES.includes(value) ? value : 'system';
  } catch (error) {
    return 'system';
  }
}

/** @type {!MediaQueryList|null} The system dark-mode query, or null outside a browser. */
const darkQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

/** @type {!import('@preact/signals').Signal<string>} The viewer's preference. */
export const themeChoice = signal(storedChoice());

/** @type {!import('@preact/signals').Signal<boolean>} Whether the system is dark now. */
const systemDark = signal(Boolean(darkQuery && darkQuery.matches));

if (darkQuery) {
  darkQuery.addEventListener('change', (event) => {
    systemDark.value = event.matches;
  });
}

/**
 * The theme actually painted: 'light' or 'dark'.
 * @type {!import('@preact/signals').ReadonlySignal<string>}
 */
export const resolvedTheme = computed(() => {
  if (themeChoice.value === 'system') {
    return systemDark.value ? 'dark' : 'light';
  }
  return themeChoice.value;
});

effect(() => {
  if (typeof document === 'undefined') {
    return;
  }
  const choice = themeChoice.value;
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch (error) {
    /* A viewer who blocks storage still gets the theme, just not next visit. */
  }
});

/**
 * Moves to the next theme setting, cycling system → light → dark.
 * @returns {void}
 */
export function cycleTheme() {
  const next = (THEME_CHOICES.indexOf(themeChoice.value) + 1) % THEME_CHOICES.length;
  themeChoice.value = THEME_CHOICES[next];
}
