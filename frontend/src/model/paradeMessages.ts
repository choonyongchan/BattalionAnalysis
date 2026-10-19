/** How a stored parade-state message reads on the Deposit page: source, outcome and arrival time. */

import { receivedInSgt } from '../../../shared/dates.ts';
import { MANUAL_ID_PREFIX, type IntakeReply, type MessageSummary } from '../../../shared/paradeMessage.ts';

/** Status labels, in the order a clerk should deal with them. */
export const MESSAGE_STATUS = {
  NEEDS_REVIEW: 'Needs review',
  REJECTED: 'Rejected',
  PENDING: 'Pending',
  PARSED: 'Parsed',
} as const;

export type MessageStatus = (typeof MESSAGE_STATUS)[keyof typeof MESSAGE_STATUS];

/** One row of the Deposit page's message table. */
export interface MessageRow {
  id: number;
  parade: string;
  status: MessageStatus;
  source: 'Manual' | 'WhatsApp';
  received: { date: string; time: string } | null;
  problems: number;
}

/** What the page says after a deposit or an edit; `reasons` lists what to fix. */
export interface OutcomeNote {
  tone: 'good' | 'error';
  text: string;
  reasons: string[];
}

/** A submission key for display: `Archer_2026-09-18_FPS` as `Archer · 2026-09-18 · FPS`, or ''. */
function paradeLabel(paradeResponseId: string | null | undefined): string {
  return paradeResponseId ? paradeResponseId.replace(/_/g, ' · ') : '';
}

/** Where a message came from. */
export function sourceOf(waMessageId: string): MessageRow['source'] {
  return waMessageId.startsWith(MANUAL_ID_PREFIX) ? 'Manual' : 'WhatsApp';
}

/** What became of a message. */
export function statusOf(message: Pick<MessageSummary, 'paradeResponseId' | 'outcome'>): MessageStatus {
  if (message.paradeResponseId) return MESSAGE_STATUS.PARSED;
  if (message.outcome === 'needs_review') return MESSAGE_STATUS.NEEDS_REVIEW;
  if (message.outcome === 'rejected') return MESSAGE_STATUS.REJECTED;
  return MESSAGE_STATUS.PENDING;
}

/** The stored messages as table rows, newest first as the API returns them. */
export function toMessageRows(messages: MessageSummary[]): MessageRow[] {
  return messages.map((message) => ({
    id: message.id,
    parade: paradeLabel(message.paradeResponseId) || '—',
    status: statusOf(message),
    source: sourceOf(message.waMessageId),
    received: receivedInSgt(message.receivedAt),
    problems: message.problems || 0,
  }));
}

/** What the page says after a deposit or an edit: good when rows were written, error when text needs fixing. */
export function describeOutcome(outcome: IntakeReply): OutcomeNote {
  const key = paradeLabel(outcome.paradeResponseId);
  switch (outcome.status) {
    case 'parsed': {
      const people = outcome.counts?.personnel ?? 0;
      return { tone: 'good', text: `Saved ${key}: ${people} personnel line${people === 1 ? '' : 's'}.`, reasons: [] };
    }
    case 'already_parsed':
      return { tone: 'good', text: `Already stored as ${key}. Edit that entry below to change it.`, reasons: [] };
    case 'needs_review':
      return { tone: 'error', text: 'Not saved as parade data. Correct these lines and try again:', reasons: outcome.problems ?? [] };
    case 'rejected':
    case 'invalid':
      return { tone: 'error', text: 'Not saved as parade data:', reasons: [outcome.reason ?? ''] };
    default:
      return { tone: 'error', text: 'The intake gave an answer this page does not recognise.', reasons: [] };
  }
}
