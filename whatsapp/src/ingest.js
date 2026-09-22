/**
 * Relays accepted parade states to the Vercel intake, `api/parade.ts`.
 *
 * Parsing used to run here because the OpenAI extraction took 74-126 seconds, past Vercel
 * Hobby's 60-second cap. The rule-based parser takes about a millisecond, so storing and
 * parsing now happen in one request on Vercel, and this process only forwards text. It
 * holds no database credentials.
 *
 * The intake is idempotent on the WhatsApp message id, so a retry after a timeout whose
 * request did land is harmless.
 */

/** @type {number} Attempts per message before giving up. */
const MAX_ATTEMPTS = 3;

/** @type {number} Delay before the second attempt; doubled for each one after. */
const RETRY_BASE_MS = 2_000;

/** @type {number} How long one request may take before it counts as failed. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Raised when the intake could not be reached, or kept failing, on every attempt. */
export class RelayError extends Error {
  /**
   * @param {string} message What went wrong, without the message text.
   */
  constructor(message) {
    super(message);
    this.name = 'RelayError';
  }
}

/**
 * Builds the relay the message handler calls.
 *
 * @param {Object} deps Dependencies.
 * @param {string} deps.url The intake URL, e.g. https://40sar.vercel.app/api/parade.
 * @param {string} deps.secret `PARADE_INGEST_SECRET`, sent as a bearer token.
 * @param {typeof fetch=} deps.fetchImpl Injected in tests.
 * @param {function(number): !Promise<void>=} deps.sleep Injected in tests.
 * @returns {{ingest: function(string, string): !Promise<!Object>}} The relay. `ingest`
 *   resolves with the intake's JSON answer (`status` is parsed, already_parsed, rejected,
 *   needs_review or invalid).
 */
export function createIngestor({
  url,
  secret,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  /**
   * Sends one message, once.
   *
   * @param {string} text The parade-state text.
   * @param {string} messageId The Baileys message id.
   * @returns {!Promise<{retry: boolean, outcome: (Object|undefined), reason: string}>}
   *   The answer, or whether the failure is worth another attempt.
   */
  async function attempt(text, messageId) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ waMessageId: messageId, body: text }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      return { retry: true, reason: `intake unreachable: ${err.name}` };
    }
    if (response.status >= 500) return { retry: true, reason: `intake answered ${response.status}` };

    const outcome = await response.json().catch(() => null);
    // 200 (parsed) and 422 (a person must correct it) are both final answers from the parser.
    if (response.ok || response.status === 422) {
      if (outcome && typeof outcome.status === 'string') return { retry: false, outcome, reason: '' };
    }
    return { retry: false, reason: `intake answered ${response.status}` };
  }

  /**
   * Relays one message, retrying network failures and 5xx answers.
   *
   * @param {string} text The parade-state text.
   * @param {string} messageId The Baileys message id.
   * @returns {!Promise<!Object>} The intake's answer.
   * @throws {RelayError} When no attempt produced a final answer.
   */
  async function ingest(text, messageId) {
    let reason = '';
    for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
      const result = await attempt(text, messageId);
      if (result.outcome) return result.outcome;
      reason = result.reason;
      if (!result.retry) break;
      if (n < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * 2 ** (n - 1));
    }
    throw new RelayError(reason);
  }

  return { ingest };
}
