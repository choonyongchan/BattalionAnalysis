/**
 * Entry point for the WhatsApp parade-state ingestor.
 *
 * Pipeline: WhatsApp group message -> first-parade check -> POST to the Vercel
 * intake (`api/parade.ts`), which stores and parses it. See ingest.js.
 */

import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { describeError } from './errors.js';
import { createIngestor } from './ingest.js';
import { isParadeState } from './signature.js';
import { startListener } from './listener.js';

/** @type {!Object<string, string>} The log line for each intake answer. */
const OUTCOME_MESSAGES = {
  parsed: 'parade state stored and parsed',
  already_parsed: 'parade state already known',
  rejected: 'parade state rejected by the parser',
  needs_review: 'parade state stored; needs correcting on the dashboard',
  invalid: 'parade state stored; needs correcting on the dashboard',
};

/**
 * Builds the handler invoked for every message in the watched group.
 *
 * There is no local record of what has already been relayed. Dedup is the
 * `wa_message_id` unique constraint behind the intake, so a resend after a
 * restart is harmless.
 *
 * @param {Object} deps Handler dependencies.
 * @param {Object} deps.config Resolved configuration from loadConfig().
 * @param {import('pino').Logger} deps.logger Logger for status output.
 * @param {{ingest: function(string, string): !Promise<Object>}} deps.ingestor
 *   From createIngestor(); resolves with the intake's answer.
 * @returns {function(string, Object): Promise<void>} The message handler.
 */
export function createMessageHandler({ config, logger, ingestor }) {
  return async function handleMessage(text, envelope) {
    const messageId = envelope.key?.id || '';
    // remoteJid is logged so a blank WA_GROUP_ID dry run reveals the group's JID.
    const remoteJid = envelope.key?.remoteJid;
    const { accepted, rejectReason } = isParadeState(text);

    if (!accepted) {
      logger.debug({ messageId, remoteJid, reason: rejectReason }, 'ignored non-parade-state message');
      return;
    }

    const summary = { messageId, chars: text.length };

    if (config.dryRun) {
      logger.info({ ...summary, remoteJid }, 'DRY_RUN: parade state accepted but not stored');
      return;
    }

    try {
      const outcome = await ingestor.ingest(text, messageId);
      // Status, id and key only: a rejection reason or a parser problem can quote a
      // personnel line, and the message holds names.
      const message = OUTCOME_MESSAGES[outcome.status] || 'intake answered';
      const level = outcome.status === 'parsed' || outcome.status === 'already_parsed' ? 'info' : 'warn';
      logger[level]({ ...summary, status: outcome.status, id: outcome.id, paradeResponseId: outcome.paradeResponseId }, message);
    } catch (err) {
      logger.error({ ...summary, err: describeError(err) }, 'relay failed; deposit this parade state on the dashboard');
    }
  };
}

/**
 * Starts the ingestor.
 *
 * @returns {Promise<void>} Rejects when the WhatsApp session is unrecoverable.
 */
async function main() {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const ingestor = createIngestor({ url: config.paradeApiUrl, secret: config.ingestSecret });

  logger.info({ groupId: config.groupId, dryRun: config.dryRun }, 'starting WhatsApp parade-state ingestor');

  await startListener({
    authDir: config.authDir,
    groupId: config.groupId,
    logger,
    onMessage: createMessageHandler({ config, logger, ingestor }),
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err.message);
    // A fatal error (dead session, re-pair required) exits 3 so the supervisor
    // stops instead of restarting into the same wall; anything else exits 1 so
    // the supervisor recycles the process.
    process.exit(err && err.fatal ? 3 : 1);
  });
}
