/**
 * Entry point for the WhatsApp parade-state ingestor.
 *
 * Pipeline: WhatsApp group message -> first-parade check -> stored in Neon ->
 * parsed on this machine into parade-state rows. See ingest.js for why parsing
 * happens here and not on Vercel.
 */

import { getDb } from '../../db/index.ts';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createIngestor } from './ingest.js';
import { isParadeState } from './signature.js';
import { startListener } from './listener.js';

/**
 * Builds the handler invoked for every message in the watched group.
 *
 * There is no local record of what has already been stored. Dedup is the
 * `wa_message_id` unique constraint in Neon, so a resend after a restart is
 * harmless, and it is how a message whose parse never finished gets retried.
 *
 * @param {Object} deps Handler dependencies.
 * @param {Object} deps.config Resolved configuration from loadConfig().
 * @param {import('pino').Logger} deps.logger Logger for status output.
 * @param {{ingest: function(string, string): !Promise<Object>}} deps.ingestor
 *   From createIngestor().
 * @returns {function(string, Object): Promise<void>} The message handler.
 */
export function createMessageHandler({ config, logger, ingestor }) {
  return async function handleMessage(text, envelope) {
    const messageId = envelope.key?.id || '';
    const { accepted, rejectReason } = isParadeState(text);

    if (!accepted) {
      logger.debug({ messageId, reason: rejectReason }, 'ignored non-parade-state message');
      return;
    }

    const summary = { messageId, chars: text.length };

    if (config.dryRun) {
      logger.info(summary, 'DRY_RUN: parade state accepted but not stored');
      return;
    }

    try {
      const outcome = await ingestor.ingest(text, messageId);
      logger.info({ ...summary, status: outcome.status, id: outcome.id }, 'stored parade state');
    } catch (err) {
      logger.error({ ...summary, err: err.message }, 'store failed; will retry if the message is resent');
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
  const ingestor = createIngestor({
    db: getDb(),
    apiKey: config.openaiApiKey,
    model: config.openaiModel,
    logger,
  });

  logger.info({ groupId: config.groupId, dryRun: config.dryRun }, 'starting WhatsApp parade-state ingestor');

  // Anything stored but left unparsed by a previous crash is picked up now, and
  // transient failures (a model timeout) are swept on the interval. unref() so
  // the timer never keeps a dying process alive for the supervisor to wait on.
  if (!config.dryRun) {
    ingestor.drain();
    setInterval(() => ingestor.drain(), config.parseIntervalMs).unref();
  }

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
