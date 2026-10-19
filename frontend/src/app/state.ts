/**
 * Everything the pages read, in one place: the shell owns all state and a page is a function of it.
 * `selectedDate` is the one parade the tiles describe; `dateFrom`/`dateTo` bound every aggregate.
 */

import { signal, computed } from '@preact/signals';
import type { Dataset } from '../data/feed.ts';

/** Where the session stands. */
export type Status = 'locked' | 'loading' | 'ready' | 'error';

/** Everything the feed returned. */
export const dataset = signal<Dataset | null>(null);

/** Where the session stands. */
export const status = signal<Status>('locked');

/** The message shown on the login screen. */
export const loadError = signal('');

/** The parade date the tiles describe. */
export const selectedDate = signal<string | null>(null);

/** Range start, or null for "from the beginning". */
export const dateFrom = signal<string | null>(null);

/** Range end, or null for "to the latest". */
export const dateTo = signal<string | null>(null);

/** A company name, or 'ALL'. */
export const company = signal('ALL');

/** Whether the dashboard has data to draw. */
export const isReady = computed(() => status.value === 'ready' && dataset.value !== null);

/** Whether this session may change settings; the server decides, this mirrors its answer. */
export const canEdit = computed(() => Boolean(dataset.value?.canEdit));

/** The loaded dataset; pages render only once it exists (the router shows the login screen until then). */
export function loadedData(): Dataset {
  if (!dataset.value) throw new Error('A page rendered before the dataset loaded.');
  return dataset.value;
}
