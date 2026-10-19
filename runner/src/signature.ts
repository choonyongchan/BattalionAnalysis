/**
 * Decides from the text alone whether a group message is a first parade state worth relaying.
 * Gates: no last-parade marker, a first-parade marker, enough bulk, and a strength line.
 * Whether it really is a parade state is the parser's call on the server.
 */

import { isFirstParade, isLastParade } from '../../shared/paradeMessage.ts';

/** Minimum non-empty lines a parade state has. */
const MIN_LINES = 8;

/** Minimum characters a parade state has. */
const MIN_CHARS = 200;

/** Non-empty lines at the top that count as the header, so a stray "FP" in the body is ignored. */
const HEADER_LINES = 5;

/** A strength line such as "COMPANY: 197/210". */
const STRENGTH_LINE = /:\s*\d{1,4}\s*\/\s*\d{1,4}\s*$/m;

/** The verdict, with a human-readable reason when rejected. */
export interface Verdict {
  accepted: boolean;
  rejectReason: string | null;
}

/** The lines with at least one non-space character. */
function nonEmptyLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

/** Classifies a message as a first parade state or not. */
export function isParadeState(text: unknown): Verdict {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { accepted: false, rejectReason: 'empty message' };
  }
  const lines = nonEmptyLines(text);
  const header = lines.slice(0, HEADER_LINES).join('\n');
  if (isLastParade(header)) {
    return { accepted: false, rejectReason: 'a last parade state (LAST PARADE / LPS / LP in the header)' };
  }
  if (!isFirstParade(header)) {
    return { accepted: false, rejectReason: 'not a first parade state (no FIRST PARADE / FPS / FP in the header)' };
  }
  if (lines.length < MIN_LINES) {
    return { accepted: false, rejectReason: `too few lines (${lines.length} < ${MIN_LINES})` };
  }
  if (text.length < MIN_CHARS) {
    return { accepted: false, rejectReason: `too short (${text.length} < ${MIN_CHARS} chars)` };
  }
  if (!STRENGTH_LINE.test(text)) {
    return { accepted: false, rejectReason: 'no present/strength line (e.g. "COMPANY: 197/210")' };
  }
  return { accepted: true, rejectReason: null };
}
