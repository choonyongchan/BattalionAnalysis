/**
 * Baileys WhatsApp group listener: the session is QR-paired once and kept in `runner/auth/`.
 * Reconnect keeps exactly one live socket; two sockets writing `auth/` corrupt the session ("Bad MAC").
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type AuthenticationState,
  type UserFacingSocketConfig,
  type WAMessage,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import type { Logger } from 'pino';
import qrcode from 'qrcode-terminal';

/** Base delay before the first reconnect. */
const RECONNECT_BASE_MS = 3000;

/** Ceiling for the reconnect backoff. */
const RECONNECT_MAX_MS = 120000;

/** Consecutive failed reconnects before exiting for a clean restart. */
const MAX_RECONNECT_ATTEMPTS = 5;

/** Disconnects reconnecting cannot fix; the operator must wipe `runner/auth/` and pair again. */
const FATAL_STATUS = new Set<number | undefined>([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.connectionReplaced,
]);

type BaileysLogger = NonNullable<UserFacingSocketConfig['logger']>;

/** Called with each watched message's text and envelope. */
export type MessageHandler = (text: string, envelope: WAMessage) => Promise<void>;

/** An error that needs a human; `fatal` means re-pair rather than restart. */
export type ListenerError = Error & { fatal?: boolean };

/** Plain text of a message, captions included, or null when it carries none. */
export function extractText(message: proto.IMessage | null | undefined): string | null {
  if (!message) return null;
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.documentMessage?.caption ||
    message.videoMessage?.caption ||
    null
  );
}

/** Whether an envelope is an inbound text message from the watched group. */
export function isWatchedGroupMessage(envelope: WAMessage | null | undefined, groupId: string | null | undefined): boolean {
  if (!envelope?.key || envelope.key.fromMe) return false;
  if (envelope.key.remoteJid !== groupId) return false;
  return extractText(envelope.message) !== null;
}

/** `fatal`: re-pair; `restart`: reconnect now (normal after pairing); `retry`: reconnect with backoff. */
export function classifyDisconnect(statusCode: number | undefined): 'fatal' | 'restart' | 'retry' {
  if (FATAL_STATUS.has(statusCode)) return 'fatal';
  if (statusCode === DisconnectReason.restartRequired) return 'restart';
  return 'retry';
}

/** Backoff before the nth reconnect: 3 s doubling, capped at 2 minutes. */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
}

/** The logger Baileys gets: warnings and errors only, without payloads (they hold JIDs, numbers and names). */
export function baileysLogger(logger: Logger): BaileysLogger {
  const out = logger.child({ component: 'baileys' });
  const keep =
    (level: 'warn' | 'error' | 'fatal') =>
    (obj: unknown, msg?: string): void => {
      if (typeof obj === 'string') return out[level](obj);
      const record = obj as { err?: { message?: string }; error?: { message?: string } } | null;
      const err = record?.err ?? record?.error;
      out[level](err?.message ? { err: err.message } : {}, msg);
    };
  const quiet = (): void => {};
  const self = {
    level: 'warn',
    child: () => self,
    trace: quiet,
    debug: quiet,
    info: quiet,
    warn: keep('warn'),
    error: keep('error'),
    fatal: keep('fatal'),
  };
  return self;
}

/** Builds one configured Baileys socket. */
function createSocket(version: [number, number, number], state: AuthenticationState, logger: Logger): WASocket {
  return makeWASocket({
    version,
    auth: state,
    logger: baileysLogger(logger),
    browser: ['BattalionDataAnalysis', 'Chrome', '1.0.0'],
  });
}

/** Wires the credential, message and connection handlers onto a socket. */
function attachHandlers({
  socket,
  groupId,
  logger,
  onMessage,
  onOpen,
  saveCreds,
  onClose,
}: {
  socket: WASocket;
  groupId: string;
  logger: Logger;
  onMessage: MessageHandler;
  onOpen: () => void;
  saveCreds: () => Promise<void>;
  onClose: (statusCode: number | undefined) => void;
}): void {
  socket.ev.on('creds.update', saveCreds);

  // Every upsert type, not just 'notify': messages missed while down replay as 'append'.
  // Replays are harmless, the intake dedups on wa_message_id.
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const envelope of messages) {
      if (!isWatchedGroupMessage(envelope, groupId || envelope.key?.remoteJid)) continue;
      try {
        await onMessage(extractText(envelope.message)!, envelope);
      } catch (err) {
        logger.error({ err: (err as Error).message, messageId: envelope.key?.id }, 'message handler failed');
      }
    }
  });

  socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info('scan this QR code in WhatsApp > Linked devices');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      logger.info('connected to WhatsApp');
      onOpen();
      return;
    }
    if (connection === 'close') {
      const error = lastDisconnect?.error as { output?: { statusCode?: number } } | undefined;
      onClose(error?.output?.statusCode);
    }
  });
}

/** Removes a socket's listeners and ends it; a throw here never masks the disconnect reason. */
function teardownSocket(socket: WASocket, logger: Logger): void {
  try {
    // Name each event: Node treats an explicit `undefined` as an event name and removes nothing.
    for (const event of ['creds.update', 'messages.upsert', 'connection.update'] as const) {
      socket.ev.removeAllListeners(event);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'failed to remove socket listeners');
  }
  try {
    socket.end(undefined);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'failed to end socket');
  }
}

/**
 * Connects and streams messages from the watched group ('' watches every chat).
 * Never resolves; rejects with `fatal` when the session is dead, or without it after too many reconnects.
 */
export async function startListener({
  authDir,
  groupId,
  logger,
  onMessage,
}: {
  authDir: string;
  groupId: string;
  logger: Logger;
  onMessage: MessageHandler;
}): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((_resolve, reject) => {
    let attempt = 0;
    let closing = false;

    /** Builds a fresh socket and arms its handlers. */
    function connect(): void {
      closing = false;
      const socket = createSocket(version, state, logger);
      attachHandlers({
        socket,
        groupId,
        logger,
        onMessage,
        onOpen: () => {
          attempt = 0;
        },
        saveCreds,
        onClose: (statusCode) => handleClose(socket, statusCode),
      });
    }

    /** Tears down the dead socket, then reconnects or rejects for operator action. */
    function handleClose(socket: WASocket, statusCode: number | undefined): void {
      if (closing) return;
      closing = true;
      teardownSocket(socket, logger);

      const kind = classifyDisconnect(statusCode);
      if (kind === 'fatal') {
        const err: ListenerError = new Error(
          `WhatsApp session is dead (statusCode=${statusCode}). Delete runner/auth/ and re-pair: ` +
            'run `bun run runner:reset-auth`, then `bun run runner`.',
        );
        err.fatal = true;
        logger.error(err.message);
        reject(err);
        return;
      }
      if (kind === 'restart') {
        logger.info({ statusCode }, 'WhatsApp asked for a restart; reconnecting now');
        connect();
        return;
      }
      attempt += 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) {
        reject(new Error(`WhatsApp reconnect failed ${MAX_RECONNECT_ATTEMPTS} times in a row; exiting for a clean restart.`));
        return;
      }
      const delay = reconnectDelayMs(attempt);
      logger.warn({ statusCode, attempt }, `connection closed, reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    }

    connect();
  });
}
