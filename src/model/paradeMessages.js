/**
 * How a stored parade-state message reads on the Deposit page: where it came from,
 * what became of it, and when it arrived.
 *
 * The rules mirror `lib/pipeline.ts`: a parsed message carries its `paradeResponseId`, a
 * message the parser was unsure of carries an error starting "Needs review: ", and any other
 * error is a rejection (a last parade state, or not a parade state at all).
 */

/** @type {string} The prefix `api/parade.ts` gives messages typed into the dashboard. */
const MANUAL_PREFIX = 'manual:';

/** @type {string} The prefix `lib/pipeline.ts` gives parser doubts. */
const NEEDS_REVIEW_PREFIX = 'Needs review: ';

/**
 * The status labels, in the order a clerk should deal with them.
 * @enum {string}
 */
export const MESSAGE_STATUS = {
  NEEDS_REVIEW: 'Needs review',
  REJECTED: 'Rejected',
  PENDING: 'Pending',
  PARSED: 'Parsed',
};

/**
 * Where a message came from.
 * @param {string} waMessageId The message's idempotency key.
 * @returns {string} 'Manual' or 'WhatsApp'.
 */
export function sourceOf(waMessageId) {
  return String(waMessageId).startsWith(MANUAL_PREFIX) ? 'Manual' : 'WhatsApp';
}

/**
 * What became of a message.
 * @param {{paradeResponseId: ?string, error: ?string, processedAt: ?string}} message A summary
 *     from `GET /api/parade`.
 * @returns {string} One of MESSAGE_STATUS.
 */
export function statusOf(message) {
  if (message.paradeResponseId) return MESSAGE_STATUS.PARSED;
  if (message.error) {
    return message.error.startsWith(NEEDS_REVIEW_PREFIX) ? MESSAGE_STATUS.NEEDS_REVIEW : MESSAGE_STATUS.REJECTED;
  }
  return MESSAGE_STATUS.PENDING;
}

/**
 * The reasons a message produced no rows, one per line the parser doubted.
 * @param {?string} error The stored error.
 * @returns {!Array<string>} The reasons; empty for a parsed message.
 */
export function reasonsOf(error) {
  if (!error) return [];
  return error.startsWith(NEEDS_REVIEW_PREFIX) ? error.slice(NEEDS_REVIEW_PREFIX.length).split(' | ') : [error];
}

/** @type {number} Singapore is UTC+8 all year, with no daylight saving. */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * A receipt time as a Singapore date and clock time, which is how every parade date in
 * this unit is read. Formatting is left to `src/format.js`.
 * @param {string} timestamp An ISO timestamp.
 * @returns {?{date: string, time: string}} e.g. {date: '2026-09-18', time: '07:31'}, or null
 *     when the timestamp is unreadable.
 */
export function receivedInSgt(timestamp) {
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return null;
  const iso = new Date(time + SGT_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * Shapes the stored messages for the table, newest first as the API returns them.
 * @param {!Array<!Object>} messages Summaries from `GET /api/parade`.
 * @returns {!Array<{id: number, parade: string, status: string, source: string,
 *     received: ?{date: string, time: string}, reasons: !Array<string>}>} One row per
 *     message.
 */
export function toMessageRows(messages) {
  return messages.map((message) => ({
    id: message.id,
    parade: message.paradeResponseId ? message.paradeResponseId.replace(/_/g, ' · ') : '—',
    status: statusOf(message),
    source: sourceOf(message.waMessageId),
    received: receivedInSgt(message.receivedAt),
    reasons: reasonsOf(message.error),
  }));
}

/**
 * What the page says after a deposit or an edit.
 * @param {!Object} outcome The intake's answer (`status` plus fields for that status).
 * @returns {{tone: string, text: string, reasons: !Array<string>}} `tone` is 'good' when rows
 *     were written and 'error' when the text needs correcting; `reasons` lists what to fix.
 */
export function describeOutcome(outcome) {
  const key = outcome.paradeResponseId ? outcome.paradeResponseId.replace(/_/g, ' · ') : '';
  switch (outcome.status) {
    case 'parsed': {
      const people = outcome.counts ? outcome.counts.personnel : 0;
      return { tone: 'good', text: `Saved ${key}: ${people} personnel line${people === 1 ? '' : 's'}.`, reasons: [] };
    }
    case 'already_parsed':
      return { tone: 'good', text: `Already stored as ${key}. Edit that entry below to change it.`, reasons: [] };
    case 'needs_review':
      return { tone: 'error', text: 'Not saved as parade data. Correct these lines and try again:', reasons: outcome.problems || [] };
    case 'rejected':
    case 'invalid':
      return { tone: 'error', text: 'Not saved as parade data:', reasons: [outcome.reason] };
    default:
      return { tone: 'error', text: 'The intake gave an answer this page does not recognise.', reasons: [] };
  }
}
