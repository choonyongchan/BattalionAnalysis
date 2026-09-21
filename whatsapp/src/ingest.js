/**
 * Stores accepted parade states in Neon and parses them, on this machine.
 *
 * This replaced a relay to Apps Script and, briefly, to a Vercel route plus a
 * cron drain. Parsing moved here because one extraction takes 74-126 seconds.
 * That is past Vercel Hobby's 60-second function cap, and Hobby also refuses
 * sub-daily crons. A long-running process has neither limit.
 *
 * Every write still goes through lib/pipeline.ts: `recordMessage` stores the
 * text idempotently on the WhatsApp message id, and `parseDue` extracts and
 * replaces rows. Nothing here touches a table directly.
 *
 * Storing and parsing stay split, as they were on Vercel. `ingest` returns once
 * the text is durable, and the parse runs behind it. A crash mid-parse
 * therefore loses nothing: the row stays unprocessed and the next drain,
 * including the one at start-up, picks it up.
 */

import { describeError } from './errors.js';
import { parseDue, recordMessage } from '../../lib/pipeline.ts';

/**
 * Counts a parse run's results by outcome, for logging.
 *
 * Counts only. A result's reason can quote the message, and the message holds
 * names and NRICs, so none of it goes to the log.
 *
 * @param {{results: !Array<{outcome: string}>, skipped: number}} run What
 *   `parseDue` returned.
 * @returns {{parsed: number, rejected: number, failed: number, skipped: number}}
 *   The tally.
 */
export function tallyRun(run) {
  const tally = { parsed: 0, rejected: 0, failed: 0, skipped: run.skipped };
  for (const result of run.results) tally[result.outcome] += 1;
  return tally;
}

/**
 * Builds the ingestor the message handler and the drain timer share.
 *
 * `drain` is single-flight. A call made while a run is in progress does not
 * start a second one. It marks that more work may have arrived, and the running
 * drain goes round once more before it finishes. Two overlapping `parseDue`
 * runs would select the same rows and pay twice for each extraction.
 *
 * @param {Object} deps Dependencies.
 * @param {*} deps.db A read-write Drizzle handle, from `getDb()`.
 * @param {string} deps.apiKey OpenAI API key.
 * @param {string=} deps.model OpenAI model override.
 * @param {import('pino').Logger} deps.logger Logger for outcomes.
 * @param {typeof recordMessage=} deps.record Injected in tests.
 * @param {typeof parseDue=} deps.parse Injected in tests.
 * @returns {{ingest: function(string, string): !Promise<Object>,
 *   drain: function(): !Promise<void>}} The ingestor.
 */
export function createIngestor({ db, apiKey, model, logger, record = recordMessage, parse = parseDue }) {
  /** @type {?Promise<void>} The drain in progress, if any. */
  let running = null;
  /** @type {boolean} Whether another pass is needed after the current one. */
  let again = false;

  /**
   * Runs parse passes until nothing new has arrived and no pass-over-pass progress
   * remains to be made on the backlog.
   *
   * A backlog (`skipped > 0`) alone is not reason enough to go again: extract.ts treats
   * a 401, a 429 and an outage as transient, so those rows stay unprocessed and
   * `skipped` stays positive on every pass. With more than one pass' worth of backlog,
   * looping on `skipped > 0` alone retries the same rows forever. Requiring that the
   * pass also parsed or rejected at least one row tells transient backlog (no progress,
   * stop and let the next drain retry) apart from a real one (progress, keep going).
   *
   * @returns {!Promise<void>} Resolves when the queue is drained, the backlog stops
   *   shrinking, or a pass fails.
   */
  async function loop() {
    try {
      let more = true;
      while (more) {
        again = false;
        const run = await parse(db, { apiKey, model });
        const tally = tallyRun(run);
        if (run.results.length > 0) logger.info(tally, 'parse run finished');
        more = again || (run.skipped > 0 && tally.parsed + tally.rejected > 0);
      }
    } catch (err) {
      // Swallowed deliberately: an unreachable database must not take down the
      // listener. The messages stay unprocessed and the next drain retries them.
      //
      // describeError, not err.message: a markFailed insert failing mid-write wraps in
      // drizzle-orm's DrizzleQueryError, whose message quotes the query params -- here,
      // the rejection reason, which can quote the parade-state body.
      logger.error({ err: describeError(err) }, 'parse run failed; will retry on the next drain');
    } finally {
      running = null;
    }
  }

  /**
   * Drains the parse queue, or asks the drain already in progress to go again.
   *
   * @returns {!Promise<void>} Resolves when the drain covering this call ends.
   */
  function drain() {
    if (running) {
      again = true;
      return running;
    }
    running = loop();
    return running;
  }

  /**
   * Stores one message, then starts a drain without waiting for it.
   *
   * @param {string} text The parade-state text.
   * @param {string} messageId The Baileys message id.
   * @returns {!Promise<Object>} The `recordMessage` outcome.
   */
  async function ingest(text, messageId) {
    const outcome = await record(db, { waMessageId: messageId, body: text, source: 'whatsapp' });
    if (outcome.status !== 'already_processed') drain();
    return outcome;
  }

  return { ingest, drain };
}
