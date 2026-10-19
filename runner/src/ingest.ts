/**
 * Relays accepted parade states to the intake (`backend/api/parade.ts`), which stores and parses them.
 * The intake is idempotent on the WhatsApp message id, so a retry after a timeout is harmless.
 */

import type { IntakeReply } from '../../shared/paradeMessage.ts';

/** Attempts per message before giving up. */
const MAX_ATTEMPTS = 3;

/** Delay before the second attempt; doubled for each one after. */
const RETRY_BASE_MS = 2_000;

/** The intake's 300 s function limit, so a slow model fallback is not cut off and re-sent. */
const REQUEST_TIMEOUT_MS = 300_000;

/** Relays one message and resolves with the intake's answer. */
export interface Ingestor {
  ingest(text: string, messageId: string): Promise<IntakeReply>;
}

/** Raised when no attempt reached the intake or got a final answer. */
export class RelayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RelayError';
  }
}

type Attempt = { outcome: IntakeReply } | { retry: boolean; reason: string };

/** Builds the relay; `fetchImpl` and `sleep` are injected in tests. */
export function createIngestor({
  url,
  secret,
  fetchImpl = fetch,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}: {
  url: string;
  secret: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Ingestor {
  /** Sends one message once; network failures and 5xx are worth retrying. */
  async function attempt(text: string, messageId: string): Promise<Attempt> {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ waMessageId: messageId, body: text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return { retry: true, reason: `intake unreachable: ${(err as Error).name}` };
    }
    if (response.status >= 500) return { retry: true, reason: `intake answered ${response.status}` };

    const outcome = (await response.json().catch(() => null)) as IntakeReply | null;
    // 200 (parsed) and 422 (a person must correct it) are both final answers.
    if ((response.ok || response.status === 422) && typeof outcome?.status === 'string') return { outcome };
    return { retry: false, reason: `intake answered ${response.status}` };
  }

  /** Relays one message, retrying with backoff; throws `RelayError` when every attempt fails. */
  async function ingest(text: string, messageId: string): Promise<IntakeReply> {
    let reason = '';
    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      const result = await attempt(text, messageId);
      if ('outcome' in result) return result.outcome;
      reason = result.reason;
      if (!result.retry) break;
      if (n < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (n - 1));
    }
    throw new RelayError(reason);
  }

  return { ingest };
}
