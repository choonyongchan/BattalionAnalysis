/**
 * Detection of first-parade-state messages.
 *
 * WhatsApp groups carry ordinary chatter alongside the parade states we care
 * about. This module decides, from the message text alone, whether a message is
 * worth storing, so chatter never reaches the database.
 *
 * Only a first parade state is accepted. The gates, in order:
 *   1. The header must not name a last parade ("LAST PARADE", "LPS", "LP").
 *   2. The header must name a first parade ("FIRST PARADE", "FPS", "FP").
 *      There is no fallback: a message that never says which parade it is, or
 *      only mentions "parade state", is rejected.
 *   3. Bulk: enough lines and characters to be a whole parade state.
 *   4. At least one present/strength line ("COMPANY: 197/210"), which every
 *      parade state carries (template rule R10) and chatter does not.
 *
 * There used to be a score over six layout signals, needing three matches to
 * accept. It is gone. Deciding whether a message is a real parade state is what
 * `extract` and `validate` (lib/parser/) do, by reading the message rather than
 * guessing from its shape. A message that clears the gates but is not a parade
 * state is stored anyway, and its raw_messages row carries the reason in `error`.
 */

/** @type {number} Minimum non-empty lines a parade state must have. */
const MIN_LINES = 8;

/** @type {number} Minimum characters a parade state must have. */
const MIN_CHARS = 200;

/**
 * @type {number} How many non-empty lines from the top count as the header.
 * The company, date, session and timing always sit in this block; searching
 * only here keeps a stray "FP" or "LP" in the body out of the session check.
 */
const HEADER_LINES = 5;

/**
 * @type {RegExp} A first-parade marker as a whole token: "FIRST PARADE" /
 * "FIRST PARADE STATE", "FPS", or a bare "FP". Deliberately does not match a
 * bare "PS" or "PARADE STATE" alone.
 */
const FIRST_PARADE_PATTERN = /first\s*parade|\bFPS\b|\bFP\b/i;

/** @type {RegExp} A last-parade marker as a whole token: "LAST PARADE", "LPS", or a bare "LP". */
const LAST_PARADE_PATTERN = /last\s*parade|\bLPS\b|\bLP\b/i;

/**
 * @type {RegExp} A present/strength line such as "COMPANY: 197/210" or
 * "[OFFICER]: 05/07": a label, a colon, then the pair ending the line.
 */
const STRENGTH_LINE_PATTERN = /:\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/m;

/**
 * Returns the lines of the text that contain at least one non-space glyph.
 *
 * @param {string} text Raw message text.
 * @returns {string[]} The non-empty lines, in order.
 */
function nonEmptyLines(text) {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/**
 * Returns the header block of a message.
 *
 * @param {string} text Raw message text.
 * @returns {string} The first HEADER_LINES non-empty lines, newline-joined.
 */
function extractHeader(text) {
  return nonEmptyLines(text).slice(0, HEADER_LINES).join('\n');
}

/**
 * Reports whether a message's header labels it a first parade state.
 *
 * A header that names a last parade is never a first parade, even if it also
 * carries a first-parade marker.
 *
 * @param {string} text Raw message text.
 * @returns {boolean} True when the header names a first parade and not a last one.
 */
export function isFirstParade(text) {
  const header = extractHeader(text);
  return FIRST_PARADE_PATTERN.test(header) && !LAST_PARADE_PATTERN.test(header);
}

/**
 * Classifies a WhatsApp message as a first parade state or not.
 *
 * @param {string} text Raw message text. Non-string or empty input is rejected.
 * @returns {{accepted: boolean, rejectReason: ?string}} The verdict, plus a
 *   human-readable reason when rejected.
 */
export function isParadeState(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { accepted: false, rejectReason: 'empty message' };
  }
  const header = extractHeader(text);
  if (LAST_PARADE_PATTERN.test(header)) {
    return { accepted: false, rejectReason: 'a last parade state (LAST PARADE / LPS / LP in the header)' };
  }
  if (!FIRST_PARADE_PATTERN.test(header)) {
    return { accepted: false, rejectReason: 'not a first parade state (no FIRST PARADE / FPS / FP in the header)' };
  }

  const lineCount = nonEmptyLines(text).length;
  if (lineCount < MIN_LINES) {
    return { accepted: false, rejectReason: `too few lines (${lineCount} < ${MIN_LINES})` };
  }
  if (text.length < MIN_CHARS) {
    return { accepted: false, rejectReason: `too short (${text.length} < ${MIN_CHARS} chars)` };
  }
  if (!STRENGTH_LINE_PATTERN.test(text)) {
    return { accepted: false, rejectReason: 'no present/strength line (e.g. "COMPANY: 197/210")' };
  }

  return { accepted: true, rejectReason: null };
}
