/**
 * The vocabulary of a stored parade-state message, shared by the WhatsApp runner, the intake and
 * the Deposit page: header markers, stored-error format and the intake's reply.
 */

/** "FIRST PARADE (STATE)", "FPS" or a bare "FP"; a bare "PARADE STATE" is not enough. */
const FIRST_PARADE = /first\s*parade|\bFPS\b|\bFP\b/i;

/** "LAST PARADE (STATE)", "LPS" or a bare "LP". */
const LAST_PARADE = /last\s*parade|\bLPS\b|\bLP\b/i;

/** Whether a header names a first parade. */
export function isFirstParade(header: string): boolean {
  return FIRST_PARADE.test(header);
}

/** Whether a header names a last parade. */
export function isLastParade(header: string): boolean {
  return LAST_PARADE.test(header);
}

/** Prefix of the id of a message typed into the dashboard (the rest is its text's hash). */
export const MANUAL_ID_PREFIX = 'manual:';

/** Prefix of `raw_messages.error` when the parser was unsure; the doubted lines follow. */
const NEEDS_REVIEW_PREFIX = 'Needs review: ';

/** Separates the doubted lines in a stored error. */
const PROBLEM_SEPARATOR = ' | ';

/** The stored error for a parse the parser was unsure of. */
export function needsReviewError(problems: string[]): string {
  return NEEDS_REVIEW_PREFIX + problems.join(PROBLEM_SEPARATOR);
}

/** The reasons in a stored error: the doubted lines, or the one rejection reason; [] when none. */
export function reasonsOf(error: string | null | undefined): string[] {
  if (!error) return [];
  return error.startsWith(NEEDS_REVIEW_PREFIX) ? error.slice(NEEDS_REVIEW_PREFIX.length).split(PROBLEM_SEPARATOR) : [error];
}

/** What a stored error says happened, without its text (which can quote a personnel line). */
export function outcomeOf(error: string | null): { outcome: 'needs_review' | 'rejected' | null; problems: number } {
  if (!error) return { outcome: null, problems: 0 };
  if (!error.startsWith(NEEDS_REVIEW_PREFIX)) return { outcome: 'rejected', problems: 0 };
  return { outcome: 'needs_review', problems: reasonsOf(error).length };
}

/** One stored message in `GET /api/parade`'s list; carries no text. */
export interface MessageSummary {
  id: number;
  waMessageId: string;
  receivedAt: string;
  processedAt: string | null;
  paradeResponseId: string | null;
  outcome: 'needs_review' | 'rejected' | null;
  problems: number;
}

/** The intake's answer to a deposit or an edit, as the runner and the Deposit page read it. */
export interface IntakeReply {
  status: 'parsed' | 'already_parsed' | 'rejected' | 'needs_review' | 'invalid' | 'not_found' | string;
  id?: number;
  paradeResponseId?: string | null;
  counts?: Partial<Record<'strength' | 'personnel' | 'roster' | 'sectionCounts', number>>;
  problems?: string[];
  reason?: string;
}
