/**
 * The one way the browser calls the API: same-origin, so the `HttpOnly` session cookie goes with
 * every call and nothing here handles a credential.
 */

import type { FieldMessage } from '../../../shared/settings/validate.ts';

/** A parsed JSON reply; `{}` when the body was not JSON. */
export type Reply = Record<string, unknown>;

/** A refused call, with a message fit for the screen. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = String(status),
    readonly errors: FieldMessage[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Sends a same-origin request; resolves with the status and JSON body, throws when unreachable. */
export async function send(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: Reply }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Could not reach the server. Check the network connection and try again.', 0, 'unreachable');
  }
  const body = (await response.json().catch(() => ({}))) as Reply;
  return { ok: response.ok, status: response.status, body };
}

/** Calls a write route with a JSON body; a 422 is returned (it says what to correct), any other failure thrown. */
export async function callJson<T = Reply>(
  url: string,
  method: string,
  query: string,
  body: unknown,
  httpErrors: Record<number, string>,
): Promise<T> {
  const reply = await send(url + query, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (reply.ok || reply.status === 422) return reply.body as T;
  const message = httpErrors[reply.status] ?? (reply.body.error as string | undefined) ?? `The server answered ${reply.status}.`;
  throw new ApiError(message, reply.status);
}
