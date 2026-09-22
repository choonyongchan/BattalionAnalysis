/**
 * Baileys-backed WhatsApp group listener.
 *
 * WhatsApp offers no official API for reading group messages - Meta's Cloud API
 * only receives one-to-one messages sent to a business number - so the bridge
 * uses Baileys, which speaks the WhatsApp Web protocol directly over a
 * WebSocket. That makes ingestion event-driven rather than polled: new messages
 * arrive on the "messages.upsert" event.
 *
 * The session is QR-paired once and persisted under whatsapp/auth/, so ordinary
 * restarts do not require another scan.
 *
 * Reconnect keeps exactly one live socket. The old socket's listeners are
 * removed and the socket ended before a new one is built, so a flaky link can
 * never leave two sockets writing whatsapp/auth/ at once - concurrent writers
 * corrupt the libsignal session and every later decrypt fails with "Bad MAC".
 * When reconnects stop working the listener exits non-zero so the supervisor
 * recycles the whole process, which rebuilds Baileys' in-memory state cleanly
 * from auth/.
 */

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

/** @type {number} Base delay before the first reconnect attempt. */
const RECONNECT_BASE_MS = 3000;

/** @type {number} Ceiling for the exponential reconnect backoff. */
const RECONNECT_MAX_MS = 120000;

/** @type {number} Consecutive failed reconnects before exiting for a clean restart. */
const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * @type {Set<number>} Disconnect status codes that mean the session is dead or
 * has been taken over. Reconnecting cannot fix any of these; the operator must
 * wipe whatsapp/auth/ and pair again.
 */
const FATAL_STATUS = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.connectionReplaced,
]);

/**
 * Extracts plain text from a Baileys message envelope.
 *
 * Parade states arrive either as a plain conversation message or, when they are
 * long or quote another message, as an extendedTextMessage. Captions on media
 * are read too, since a screenshot with the state pasted in the caption is
 * still usable text.
 *
 * @param {Object} message The `message` field of a Baileys message envelope.
 * @returns {?string} The message text, or null when the message carries none.
 */
export function extractText(message) {
  if (!message) {
    return null;
  }
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.documentMessage?.caption ||
    message.videoMessage?.caption ||
    null
  );
}

/**
 * Reports whether an envelope is an inbound text message from the target group.
 *
 * Filters out the bridge's own messages, protocol/system events, and traffic
 * from any other chat.
 *
 * @param {Object} envelope A Baileys message envelope.
 * @param {string} groupId JID of the group to watch.
 * @returns {boolean} True when the envelope should be classified.
 */
export function isWatchedGroupMessage(envelope, groupId) {
  if (!envelope?.key || envelope.key.fromMe) {
    return false;
  }
  if (envelope.key.remoteJid !== groupId) {
    return false;
  }
  return extractText(envelope.message) !== null;
}

/**
 * Classifies a disconnect status code into the action the listener should take.
 *
 * @param {?number} statusCode The `lastDisconnect.error.output.statusCode`, or
 *   undefined when Baileys gave none.
 * @returns {'fatal'|'restart'|'retry'} `fatal` - session dead, give up and ask
 *   for a re-pair; `restart` - reconnect immediately with no backoff (the normal
 *   handshake step right after pairing); `retry` - reconnect with backoff.
 */
export function classifyDisconnect(statusCode) {
  if (FATAL_STATUS.has(statusCode)) {
    return 'fatal';
  }
  if (statusCode === DisconnectReason.restartRequired) {
    return 'restart';
  }
  return 'retry';
}

/**
 * Backoff before the nth consecutive reconnect attempt.
 *
 * @param {number} attempt 1-based count of the reconnect about to be made.
 * @returns {number} Milliseconds to wait: 3s doubling each attempt, capped at
 *   RECONNECT_MAX_MS.
 */
export function reconnectDelayMs(attempt) {
  return Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
}

/**
 * Builds one configured Baileys socket.
 *
 * @param {Object} params Socket parameters.
 * @param {Array<number>} params.version WhatsApp Web version from
 *   fetchLatestBaileysVersion().
 * @param {Object} params.state Auth state from useMultiFileAuthState().
 * @param {import('pino').Logger} params.logger Logger for status output.
 * @returns {Object} A live Baileys socket.
 */
function createSocket({ version, state, logger }) {
  return makeWASocket({
    version,
    auth: state,
    // 'warn' rather than 'silent' so connection-level trouble - including
    // repeated session-decrypt failures - reaches the bridge log.
    logger: logger.child({ component: 'baileys' }, { level: 'warn' }),
    browser: ['BattalionDataAnalysis', 'Chrome', '1.0.0'],
  });
}

/**
 * Wires the message, credential and connection handlers onto a socket.
 *
 * @param {Object} params Handler parameters.
 * @param {Object} params.socket The socket to attach to.
 * @param {string} params.groupId JID of the group to watch, or '' for every chat.
 * @param {import('pino').Logger} params.logger Logger for status output.
 * @param {function(?string, Object): Promise<void>} params.onMessage Per-message
 *   callback.
 * @param {function(): void} params.onOpen Called once the connection opens.
 * @param {function(): (void|Promise<void>)} params.saveCreds Baileys credential
 *   persister.
 * @param {function(?number): void} params.onClose Called with the disconnect
 *   status code when the connection closes.
 * @returns {void}
 */
function attachHandlers({ socket, groupId, logger, onMessage, onOpen, saveCreds, onClose }) {
  socket.ev.on('creds.update', saveCreds);

  // Every upsert type, not just 'notify': messages that arrived while the bridge was
  // down are replayed as 'append', and dropping them loses the parade states posted
  // during a crash. Replays are harmless -- Neon dedups on wa_message_id.
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const envelope of messages) {
      if (!isWatchedGroupMessage(envelope, groupId || envelope.key?.remoteJid)) {
        continue;
      }
      try {
        await onMessage(extractText(envelope.message), envelope);
      } catch (err) {
        logger.error({ err: err.message, messageId: envelope.key?.id }, 'message handler failed');
      }
    }
  });

  socket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

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
      onClose(lastDisconnect?.error?.output?.statusCode);
    }
  });
}

/**
 * Removes every listener from a socket and ends it.
 *
 * Each step is wrapped so a throw while tearing down a half-broken socket never
 * masks the disconnect reason that triggered the teardown.
 *
 * @param {Object} socket The socket to dispose of.
 * @param {import('pino').Logger} logger Logger for teardown warnings.
 * @returns {void}
 */
function teardownSocket(socket, logger) {
  try {
    socket.ev.removeAllListeners();
  } catch (err) {
    logger.warn({ err: err.message }, 'failed to remove socket listeners');
  }
  try {
    socket.end(undefined);
  } catch (err) {
    logger.warn({ err: err.message }, 'failed to end socket');
  }
}

/**
 * Connects to WhatsApp and streams messages from the watched group.
 *
 * The returned promise never resolves under normal operation. It rejects only
 * when a human is needed: with `err.fatal === true` when the session is dead and
 * whatsapp/auth/ must be wiped, or without it when reconnects have failed
 * MAX_RECONNECT_ATTEMPTS times in a row and the process should be recycled.
 *
 * @param {Object} options Listener options.
 * @param {string} options.authDir Directory holding the persisted session.
 * @param {string} options.groupId JID of the group to watch, or an empty string
 *   to accept messages from every chat.
 * @param {import('pino').Logger} options.logger Logger for status output.
 * @param {function(string, Object): Promise<void>} options.onMessage Called with
 *   the message text and its Baileys envelope for each watched message.
 * @returns {Promise<void>} Rejects when the listener needs operator action.
 */
export async function startListener(options) {
  const { authDir, groupId, logger, onMessage } = options;

  // useMultiFileAuthState creates authDir itself.
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  return new Promise((_resolve, reject) => {
    let attempt = 0;
    let closing = false;

    /**
     * Builds a fresh socket and arms its handlers.
     * @returns {void}
     */
    function connect() {
      closing = false;
      const socket = createSocket({ version, state, logger });

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

    /**
     * Handles a `connection: 'close'` event: tear down the dead socket, then
     * either reconnect or reject for operator action.
     * @param {Object} socket The socket that just closed.
     * @param {?number} statusCode The disconnect status code.
     * @returns {void}
     */
    function handleClose(socket, statusCode) {
      if (closing) {
        return;
      }
      closing = true;
      teardownSocket(socket, logger);

      const kind = classifyDisconnect(statusCode);

      if (kind === 'fatal') {
        const err = new Error(
          `WhatsApp session is dead (statusCode=${statusCode}). Delete whatsapp/auth/ and re-pair: ` +
            'run `bun run whatsapp:reset-auth`, then `bun run whatsapp`.'
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
        reject(
          new Error(
            `WhatsApp reconnect failed ${MAX_RECONNECT_ATTEMPTS} times in a row; exiting for a clean restart.`
          )
        );
        return;
      }

      const delay = reconnectDelayMs(attempt);
      logger.warn({ statusCode, attempt }, `connection closed, reconnecting in ${delay}ms`);
      setTimeout(connect, delay);
    }

    connect();
  });
}
