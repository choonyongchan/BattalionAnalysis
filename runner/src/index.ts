/** WhatsApp bridge entry point: group message, first-parade check, POST to the intake. */

import { loadConfig, type Config } from './config.ts';
import { createLogger, type Log } from './logger.ts';
import { createIngestor, type Ingestor } from './ingest.ts';
import { isParadeState } from './signature.ts';
import { startListener, type ListenerError, type MessageHandler } from './listener.ts';

/** The log line for each intake answer. */
const OUTCOME_MESSAGES: Record<string, string> = {
  parsed: 'parade state stored and parsed',
  already_parsed: 'parade state already known',
  rejected: 'parade state rejected by the parser',
  needs_review: 'parade state stored; needs correcting on the dashboard',
  invalid: 'parade state stored; needs correcting on the dashboard',
};

/** Builds the per-message handler; dedup is the intake's `wa_message_id` constraint, so resends are harmless. */
export function createMessageHandler({
  config,
  logger,
  ingestor,
}: {
  config: Pick<Config, 'dryRun'>;
  logger: Pick<Log, 'debug' | 'info' | 'warn' | 'error'>;
  ingestor: Ingestor;
}): MessageHandler {
  return async function handleMessage(text, envelope) {
    const messageId = envelope.key?.id || '';
    // remoteJid is logged so a blank-WA_GROUP_ID dry run reveals the group's JID.
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
      // Status, id and key only: reasons and problems can quote a personnel line.
      const message = OUTCOME_MESSAGES[outcome.status] ?? 'intake answered';
      const level = outcome.status === 'parsed' || outcome.status === 'already_parsed' ? 'info' : 'warn';
      logger[level]({ ...summary, status: outcome.status, id: outcome.id, paradeResponseId: outcome.paradeResponseId }, message);
    } catch (err) {
      const { name, message } = (err ?? {}) as Partial<Error>;
      logger.error({ ...summary, err: { name, message } }, 'relay failed; deposit this parade state on the dashboard');
    }
  };
}

/** Starts the bridge; rejects when the WhatsApp session is unrecoverable. */
async function main(): Promise<void> {
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
  main().catch((err: ListenerError) => {
    console.error(err.message);
    // Exit 3 (dead session) stops the supervisor; anything else exits 1 so it restarts.
    process.exit(err?.fatal ? 3 : 1);
  });
}
