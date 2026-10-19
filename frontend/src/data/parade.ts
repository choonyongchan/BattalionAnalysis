/** The Deposit page's calls to the parade-state intake, `/api/parade`. */

import type { IntakeReply, MessageSummary } from '../../../shared/paradeMessage.ts';
import { callJson } from './api.ts';

const API = '/api/parade';

const HTTP_ERRORS: Record<number, string> = {
  401: 'The session has ended. Reload the page and unlock it again.',
  404: 'That parade state no longer exists. Reload the list.',
  413: 'That is too long to be a parade state.',
  503: 'The intake is not configured yet. Set DASHBOARD_PASSWORD on Vercel.',
};

/** One message's text and stored error, opened for editing. */
export interface StoredMessage {
  id: number;
  body: string;
  error: string | null;
}

/** Calls the intake. */
function call<T>(method: string, query: string, body?: unknown): Promise<T> {
  return callJson<T>(API, method, query, body, HTTP_ERRORS);
}

/** Every stored message, newest first, without text. */
export async function listMessages(): Promise<MessageSummary[]> {
  return (await call<{ messages?: MessageSummary[] }>('GET', '')).messages ?? [];
}

/** One message's text, and the stored reasons it produced no rows. */
export function getMessage(id: number): Promise<StoredMessage> {
  return call('GET', '?id=' + id);
}

/** Deposits a parade state and parses it. */
export function depositMessage(body: string): Promise<IntakeReply> {
  return call('POST', '', { body });
}

/** Replaces a message's text and everything parsed from it. */
export function editMessage(id: number, body: string): Promise<IntakeReply> {
  return call('PUT', '?id=' + id, { body });
}

/** Deletes a message and everything parsed from it. */
export function deleteMessage(id: number): Promise<IntakeReply> {
  return call('DELETE', '?id=' + id);
}
