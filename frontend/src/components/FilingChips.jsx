/**
 * One chip per company for a single parade: grey and struck through on the diagonal until
 * the company's first parade state for the day is received, then filled with the company's
 * own pastel.
 *
 * The strikethrough carries the same fact as the grey, in a second channel: "nothing has
 * come in from this company". Colour alone would leave the row unreadable to a colour-blind
 * reader and in a printed brief, and a struck-out box reads as "empty" at a glance.
 *
 * It replaced a timeline that placed a dot per company along the morning. The question
 * the card answers is "who has filed?", and a row of chips answers it at a glance; the
 * receipt time is still there, as a line of small text under each name.
 */

import { fmtClock } from '../format.js';

/**
 * The small line under a company's name: when its parade state reached the database.
 *
 * This is the ingestion time, not the parade time the message states, and the two can be
 * hours apart — a parade state deposited by hand in the evening says 07:00 inside it. So
 * no "late" judgement is drawn from it.
 * @param {{filed: boolean, at: ?{minutes: number}}} entry A `filingsOn` entry.
 * @returns {string} The description.
 */
function describe(entry) {
  if (!entry.filed) {
    return 'Not received';
  }
  if (!entry.at) {
    return 'Received, time not recorded';
  }
  return 'Received ' + fmtClock(entry.at.minutes);
}

/**
 * The chip row.
 * @param {{entries: Array<{company: string, filed: boolean, at: ?{minutes: number}}>}} props
 *     One `filingsOn` entry per company, in parade order.
 * @returns {!preact.VNode} The row.
 */
export function FilingChips({ entries }) {
  return (
    <ul class="filingchips">
      {entries.map((entry) => (
        <li
          key={entry.company}
          class={
            'filingchip filingchip--' +
            entry.company.toLowerCase() +
            (entry.filed ? ' filingchip--filed' : ' filingchip--missing')
          }
        >
          <span class="filingchip__name">{entry.company}</span>
          <span class="filingchip__time">{describe(entry)}</span>
        </li>
      ))}
    </ul>
  );
}
