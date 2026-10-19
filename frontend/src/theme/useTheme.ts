/**
 * Light, dark or the machine's setting. "system" stays system (it follows the machine at sunset); only an
 * explicit choice writes `data-theme`. Charts read `resolvedTheme`, the palette actually on screen.
 */

import { signal, computed, effect } from '@preact/signals';

const STORAGE_KEY = 'dashboard-theme';

/** The three settings a viewer can hold, in the order the button cycles them. */
const THEME_CHOICES = ['system', 'light', 'dark'] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** The stored preference; blocked storage (a private window) means "system", never a broken page. */
function storedChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return THEME_CHOICES.find((choice) => choice === value) ?? 'system';
  } catch {
    return 'system';
  }
}

/** The system dark-mode query, or null outside a browser. */
const darkQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

/** The viewer's preference. */
export const themeChoice = signal<ThemeChoice>(storedChoice());

/** Whether the system is dark now. */
const systemDark = signal(Boolean(darkQuery?.matches));

darkQuery?.addEventListener('change', (event) => {
  systemDark.value = event.matches;
});

/** The theme actually painted. */
export const resolvedTheme = computed<'light' | 'dark'>(() => {
  if (themeChoice.value === 'system') return systemDark.value ? 'dark' : 'light';
  return themeChoice.value;
});

effect(() => {
  if (typeof document === 'undefined') return;
  const choice = themeChoice.value;
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // A viewer who blocks storage still gets the theme, just not next visit.
  }
});

/** Moves to the next setting: system, light, dark. */
export function cycleTheme(): void {
  const next = (THEME_CHOICES.indexOf(themeChoice.value) + 1) % THEME_CHOICES.length;
  themeChoice.value = THEME_CHOICES[next]!;
}
