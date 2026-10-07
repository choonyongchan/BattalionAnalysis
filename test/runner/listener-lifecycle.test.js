/**
 * Tests for the listener's socket lifecycle: reconnect decisions, teardown and
 * the message pump.
 *
 * Baileys is replaced by fake sockets built on an EventEmitter, and setTimeout
 * is captured so a backoff can be fired by hand instead of waited out.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import * as realBaileys from '@whiskeysockets/baileys';

const { DisconnectReason } = realBaileys;

/** @type {Array<{ev: EventEmitter, end: Function}>} Every socket the listener built, in order. */
let sockets = [];

/** @type {Function} The fake credential persister the listener was given. */
const saveCreds = mock(() => {});

/** @type {Function} The fake QR renderer. */
const generateQr = mock(() => {});

/**
 * Builds a fake Baileys socket and records it.
 *
 * @returns {{ev: EventEmitter, end: Function}} The socket.
 */
function fakeMakeWASocket() {
  const socket = { ev: new EventEmitter(), end: mock(() => {}) };
  sockets.push(socket);
  return socket;
}

mock.module('@whiskeysockets/baileys', () => ({
  ...realBaileys,
  default: fakeMakeWASocket,
  useMultiFileAuthState: async () => ({ state: {}, saveCreds }),
  fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 0] }),
}));
mock.module('qrcode-terminal', () => ({ default: { generate: generateQr } }));

const { startListener } = await import('../../runner/src/listener.js');

/** @type {string} JID used as the watched group. */
const GROUP_JID = '120363000000000000@g.us';

/** @type {Array<{fn: Function, ms: number}>} Timers the listener scheduled. */
let timers = [];

/** @type {ReturnType<typeof spyOn>} The setTimeout spy. */
let timeoutSpy;

/**
 * Builds a logger whose methods record their calls.
 *
 * @returns {Object} The logger.
 */
function recordingLogger() {
  const logger = { info: mock(), warn: mock(), error: mock() };
  logger.child = () => logger;
  return logger;
}

/**
 * Starts the listener and waits until its first socket exists.
 *
 * @param {Object=} overrides Options merged over the defaults.
 * @returns {Promise<{done: Promise<void>, logger: Object, onMessage: Function}>}
 *   The listener's promise and the fakes it was given.
 */
async function start(overrides = {}) {
  const logger = recordingLogger();
  const onMessage = mock(async () => {});
  const done = startListener({ authDir: 'unused', groupId: GROUP_JID, logger, onMessage, ...overrides });
  await new Promise((resolve) => setImmediate(resolve));
  return { done, logger, onMessage };
}

/**
 * Emits a close event with the given status code on a socket.
 *
 * @param {{ev: EventEmitter}} socket The socket.
 * @param {?number} statusCode The disconnect status code.
 * @returns {void}
 */
function close(socket, statusCode) {
  socket.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { output: { statusCode } } },
  });
}

/**
 * Builds a message envelope from the watched group.
 *
 * @param {string} id The message id.
 * @param {Object=} key Fields merged over the default key.
 * @returns {Object} The envelope.
 */
function envelope(id, key = {}) {
  return { key: { id, remoteJid: GROUP_JID, fromMe: false, ...key }, message: { conversation: `text ${id}` } };
}

/**
 * Runs a socket's messages.upsert handler and waits for it to finish.
 *
 * @param {{ev: EventEmitter}} socket The socket.
 * @param {Array<Object>} messages The envelopes.
 * @returns {Promise<void>}
 */
function upsert(socket, messages) {
  return socket.ev.listeners('messages.upsert')[0]({ messages, type: 'notify' });
}

beforeEach(() => {
  sockets = [];
  timers = [];
  saveCreds.mockClear();
  generateQr.mockClear();
  timeoutSpy = spyOn(globalThis, 'setTimeout').mockImplementation((fn, ms) => {
    timers.push({ fn, ms });
    return 0;
  });
});

afterEach(() => {
  timeoutSpy.mockRestore();
});

describe('startListener disconnects', () => {
  test.each([
    ['loggedOut', DisconnectReason.loggedOut],
    ['badSession', DisconnectReason.badSession],
    ['connectionReplaced', DisconnectReason.connectionReplaced],
  ])('rejects as fatal on %s and tears the socket down', async (_name, code) => {
    const { done } = await start();
    const [socket] = sockets;
    close(socket, code);

    const err = await done.catch((e) => e);
    expect(err.fatal).toBe(true);
    expect(err.message).toContain('whatsapp:reset-auth');
    expect(socket.ev.eventNames()).toEqual([]);
    expect(socket.end).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  test('reconnects at once on restartRequired', async () => {
    await start();
    close(sockets[0], DisconnectReason.restartRequired);

    expect(sockets).toHaveLength(2);
    expect(timers).toEqual([]);
  });

  test('reconnects with a growing backoff on a plain close', async () => {
    await start();
    close(sockets[0], DisconnectReason.connectionClosed);
    expect(timers.map((t) => t.ms)).toEqual([3000]);

    timers[0].fn();
    expect(sockets).toHaveLength(2);
    close(sockets[1], DisconnectReason.connectionClosed);
    expect(timers.map((t) => t.ms)).toEqual([3000, 6000]);
  });

  test('resets the backoff once a connection opens', async () => {
    await start();
    close(sockets[0], DisconnectReason.connectionClosed);
    timers[0].fn();
    sockets[1].ev.emit('connection.update', { connection: 'open' });
    close(sockets[1], DisconnectReason.connectionClosed);

    expect(timers.map((t) => t.ms)).toEqual([3000, 3000]);
  });

  test('rejects without fatal after five failed reconnects', async () => {
    const { done } = await start();
    for (let n = 0; n < 5; n += 1) {
      close(sockets[n], DisconnectReason.connectionClosed);
      timers[n].fn();
    }
    close(sockets[5], DisconnectReason.connectionClosed);

    const err = await done.catch((e) => e);
    expect(err.fatal).toBeUndefined();
    expect(err.message).toContain('failed 5 times');
    expect(timers).toHaveLength(5);
  });

  test('ignores a second close from the same socket', async () => {
    const { done } = await start();
    const [socket] = sockets;
    const handler = socket.ev.listeners('connection.update')[0];
    close(socket, DisconnectReason.connectionClosed);
    // The first close removed the listeners, so replay the captured handler directly.
    handler({ connection: 'close', lastDisconnect: { error: { output: { statusCode: DisconnectReason.loggedOut } } } });

    expect(timers).toHaveLength(1);
    expect(socket.end).toHaveBeenCalledTimes(1);
    const settled = await Promise.race([done.then(() => 'settled', () => 'settled'), Promise.resolve('pending')]);
    expect(settled).toBe('pending');
  });

  test('logs teardown failures and still reports the disconnect', async () => {
    const { done, logger } = await start();
    const [socket] = sockets;
    socket.ev.removeAllListeners = () => {
      throw new Error('listeners boom');
    };
    socket.end = () => {
      throw new Error('end boom');
    };
    close(socket, DisconnectReason.loggedOut);

    expect((await done.catch((e) => e)).fatal).toBe(true);
    const warnings = logger.warn.mock.calls.map(([fields]) => fields.err);
    expect(warnings).toEqual(['listeners boom', 'end boom']);
  });
});

describe('startListener events', () => {
  test('passes watched messages to onMessage and skips the rest', async () => {
    const { onMessage } = await start();
    const own = envelope('own', { fromMe: true });
    const other = envelope('other', { remoteJid: 'someone@s.whatsapp.net' });
    const watched = envelope('watched');
    await upsert(sockets[0], [own, other, watched]);

    expect(onMessage.mock.calls).toEqual([['text watched', watched]]);
  });

  test('accepts every chat when no group is set', async () => {
    const { onMessage } = await start({ groupId: '' });
    await upsert(sockets[0], [envelope('a', { remoteJid: 'someone@s.whatsapp.net' })]);

    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  test('logs a failing message and carries on with the next', async () => {
    const onMessage = mock(async (text) => {
      if (text === 'text bad') throw new Error('handler boom');
    });
    const { logger } = await start({ onMessage });
    await upsert(sockets[0], [envelope('bad'), envelope('good')]);

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(logger.error.mock.calls[0][0]).toEqual({ err: 'handler boom', messageId: 'bad' });
  });

  test('persists credentials on creds.update', async () => {
    await start();
    sockets[0].ev.emit('creds.update', { me: {} });

    expect(saveCreds).toHaveBeenCalledTimes(1);
  });

  test('renders a QR code when Baileys sends one', async () => {
    await start();
    sockets[0].ev.emit('connection.update', { qr: 'qr-payload' });

    expect(generateQr).toHaveBeenCalledWith('qr-payload', { small: true });
    expect(sockets).toHaveLength(1);
  });
});
