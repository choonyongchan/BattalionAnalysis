/**
 * One chip per company for a parade: grey and struck through until its first parade state arrives, then
 * the company's pastel. The strike carries the same fact as the grey, for colour-blind readers and print.
 */

import { fmtClock } from '../format.ts';
import type { FilingStatus } from '../model/submissions.ts';

/** When the parade state reached the database (arrival, not the parade time it states, so no "late"). */
function describe(entry: FilingStatus): string {
  if (!entry.filed) return 'Not received';
  if (!entry.at) return 'Received, time not recorded';
  return 'Received ' + fmtClock(entry.at.minutes);
}

/** The chip row, one `filingsOn` entry per company in parade order. */
export function FilingChips({ entries }: { entries: FilingStatus[] }) {
  return (
    <ul class="filingchips">
      {entries.map((entry) => (
        <li
          key={entry.company}
          class={`filingchip filingchip--${entry.company.toLowerCase()} ${entry.filed ? 'filingchip--filed' : 'filingchip--missing'}`}
        >
          <span class="filingchip__name">{entry.company}</span>
          <span class="filingchip__time">{describe(entry)}</span>
        </li>
      ))}
    </ul>
  );
}
