/**
 * Detection of first-parade-state messages.
 *
 * WhatsApp groups carry ordinary chatter alongside the parade states we care
 * about. This module decides, from the message text alone, whether a message is
 * worth storing, so chatter never reaches the database.
 *
 * Two gates, in order:
 *   1. Cheap structural gates reject anything too short, and anything that
 *      carries neither the "parade state" anchor phrase nor a first-parade
 *      marker ("FPS" / "FP") in its header. This alone rejects near-misses such
 *      as "Why is your parade state late?".
 *   2. A first-parade gate, since only first parade states are processed.
 *
 * Gate 1 accepts a terse header: some companies label a first parade state with
 * only "FPS" or "FP" and never write the words "parade state" at all. Those
 * still carry the full strength and personnel body, so the line and character
 * minimums below are what keep chatter out; the anchor phrase is no longer
 * mandatory on its own.
 *
 * There used to be a third stage: a score over six layout signals (strength
 * lines, present/total ratios, unit tokens, bracketed rank groups and so on),
 * needing three matches to accept. It is gone. Deciding whether a message is a
 * real parade state is what `extract` and `validate` (lib/parser/) do, by
 * reading the message rather than guessing from its shape. A message that
 * clears the gates but is not a parade state is stored anyway, and its
 * raw_messages row carries the rejection reason in `error`.
 */

/** @type {number} Minimum non-empty lines a parade state must have. */
const MIN_LINES = 8;

/** @type {number} Minimum characters a parade state must have. */
const MIN_CHARS = 200;

/** @type {RegExp} Anchor phrase every known parade state contains. */
const ANCHOR_PATTERN = /parade\s*state/i;

/**
 * @type {number} How many non-empty lines from the top count as the header.
 * The company, date, session and timing always sit in this block; searching
 * only here keeps stray four-digit numbers in the body out of the timing check.
 */
const HEADER_LINES = 5;

/**
 * @type {RegExp} A first-parade marker as a whole token: "FIRST PARADE" /
 * "FIRST PARADE STATE" (archer, cougar, hercules, the bare form in stallion),
 * "FPS", or a bare "FP". Applied to the header block only, so a stray "FP" in
 * the body cannot trigger acceptance. Deliberately does not match a bare "PS",
 * nor "LP" / "LPS" (a last parade state).
 */
const HEADER_MARKER_PATTERN = /first\s*parade(?:\s*state)?|\bFPS\b|\bFP\b/i;

/**
 * @type {RegExp} A 24-hour HHMM timing such as 0830, 0715 or 1930.
 *
 * The digit lookaround is what makes this safe: it refuses to match inside the
 * six-digit DDMMYY dates that sit right beside the timing ("220626 FP 0738"
 * yields 0738 only), while still matching when the timing is glued to a suffix
 * ("0930HRS").
 */
const TIMING_PATTERN = /(?<!\d)(?:[01]\d|2[0-3])[0-5]\d(?!\d)/g;

/** @type {number} Timings strictly before this hour count as a first parade. */
const FIRST_PARADE_CUTOFF_HOUR = 12;

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
 * Reports whether the header carries a timing before noon.
 *
 * Companies that do not label the session still stamp the header with the
 * time the state was taken ("220626 FP 0738"), and a first parade is always a
 * morning one, so a timing before 12:00 stands in for the missing label.
 *
 * @param {string} header The message header block.
 * @returns {boolean} True when at least one HHMM timing is before noon.
 */
function hasMorningTiming(header) {
  const timings = header.match(TIMING_PATTERN);
  if (timings === null) {
    return false;
  }
  return timings.some((timing) => Number(timing.slice(0, 2)) < FIRST_PARADE_CUTOFF_HOUR);
}

/**
 * Reports whether a message is a first parade state rather than a later one.
 *
 * Only first parade states are processed, so this rejects last parade states
 * and any other session. A message qualifies on either an explicit
 * "FIRST PARADE" marker or a header timing before 12:00.
 *
 * @param {string} text Raw message text.
 * @returns {boolean} True when the message is a first parade state.
 */
export function isFirstParade(text) {
  const header = extractHeader(text);
  return HEADER_MARKER_PATTERN.test(header) || hasMorningTiming(header);
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
  if (!ANCHOR_PATTERN.test(text) && !HEADER_MARKER_PATTERN.test(extractHeader(text))) {
    return {
      accepted: false,
      rejectReason: 'no "parade state" anchor phrase and no first-parade marker in the header',
    };
  }

  const lineCount = nonEmptyLines(text).length;
  if (lineCount < MIN_LINES) {
    return { accepted: false, rejectReason: `too few lines (${lineCount} < ${MIN_LINES})` };
  }
  if (text.length < MIN_CHARS) {
    return { accepted: false, rejectReason: `too short (${text.length} < ${MIN_CHARS} chars)` };
  }
  if (!isFirstParade(text)) {
    return {
      accepted: false,
      rejectReason: 'not a first parade state (no "first parade" marker and no header timing before 12:00)',
    };
  }

  return { accepted: true, rejectReason: null };
}
