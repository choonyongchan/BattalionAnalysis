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
import { describeError } from './errors.js';
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
      // The message, not just the status, since a resend after a crash is expected and
      // "already known" reads very differently from "stored" at a glance in the log.
      const message = outcome.status === 'stored' ? 'stored parade state' : 'parade state already known';
      logger.info({ ...summary, status: outcome.status, id: outcome.id }, message);
    } catch (err) {
      // describeError, not err.message: recordMessage's insert failing wraps in
      // drizzle-orm's DrizzleQueryError, whose message quotes the query params -- here,
      // the parade-state body itself.
      logger.error({ ...summary, err: describeError(err) }, 'store failed; will retry if the message is resent');
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
