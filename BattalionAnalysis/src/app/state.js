/**
 * Everything the pages read, in one place.
 *
 * The shell owns all state; a page is a function of it. That is what keeps seven pages
 * from each growing their own copy of "which date range is selected" and drifting apart.
 *
 * The date pair and the single date answer different questions and are deliberately
 * separate. `selectedDate` names one parade — the Overview tiles and the ORBAT tree
 * describe that day and ignore the range. `dateFrom`/`dateTo` bound every aggregate:
 * trends, rates, leaderboards, the Sankey. A reader is never left wondering which slice a
 * "today" figure covers, because a today figure covers today.
 */

import { signal, computed } from '@preact/signals';

/** @type {!import('@preact/signals').Signal<?Object>} Everything the feed returned. */
export const dataset = signal(null);

/** @type {!import('@preact/signals').Signal<string>} 'locked' | 'loading' | 'ready' | 'error'. */
export const status = signal('locked');

/** @type {!import('@preact/signals').Signal<string>} The message shown when status is 'error'. */
export const loadError = signal('');

/** @type {!import('@preact/signals').Signal<?string>} The parade date the tiles describe. */
export const selectedDate = signal(null);

/** @type {!import('@preact/signals').Signal<?string>} Range start, or null for "from the beginning". */
export const dateFrom = signal(null);

/** @type {!import('@preact/signals').Signal<?string>} Range end, or null for "to the latest". */
export const dateTo = signal(null);

/** @type {!import('@preact/signals').Signal<string>} A company name, or 'ALL'. */
export const company = signal('ALL');

/**
 * Whether the dashboard has data to draw.
 * @type {!import('@preact/signals').ReadonlySignal<boolean>}
 */
export const isReady = computed(() => status.value === 'ready' && dataset.value !== null);

/**
 * Returns the dashboard to its locked state, discarding everything loaded.
 * @returns {void}
 */
export function reset() {
  dataset.value = null;
  status.value = 'locked';
  loadError.value = '';
  selectedDate.value = null;
  dateFrom.value = null;
  dateTo.value = null;
  company.value = 'ALL';
}
