/**
 * Tests for the listener's socket lifecycle: reconnect decisions, teardown and the message pump.
 * Baileys is replaced by EventEmitter sockets, and setTimeout is captured so backoffs fire by hand.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, mock, spyOn, test, type Mock } from 'bun:test';
import * as realBaileys from '@whiskeysockets/baileys';
import type { Logger } from 'pino';

const { DisconnectReason } = realBaileys;

/** A fake Baileys socket. */
interface FakeSocket {
  ev: EventEmitter;
  end: Mock<() => void>;
}

/** Every socket the listener built, in order. */
let sockets: FakeSocket[] = [];

/** The fake credential persister. */
const saveCreds = mock(async () => {});

/** The fake QR renderer. */
const generateQr = mock(() => {});

/** Builds a fake Baileys socket and records it. */
function fakeMakeWASocket(): FakeSocket {
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

const { startListener } = await import('../../runner/src/listener.ts');

/** JID used as the watched group. */
const GROUP_JID = '120363000000000000@g.us';

/** Timers the listener scheduled. */
let timers: { fn: () => void; ms: number }[] = [];

/** Undoes the setTimeout capture. */
let restoreTimeout: () => void;

/** The nth socket built. */
const socketAt = (n: number): FakeSocket => sockets[n]!;

/** Fires the nth scheduled timer. */
const fire = (n: number): void => timers[n]!.fn();

/** A logger whose methods record their calls. */
function recordingLogger() {
  const logger = { info: mock(), warn: mock(), error: mock(), child: () => logger };
  return logger;
}

/** Starts the listener and waits until its first socket exists. */
async function start(overrides: Partial<Parameters<typeof startListener>[0]> = {}) {
  const logger = recordingLogger();
  const onMessage = mock(async (_text: string, _envelope: unknown) => {});
  const done = startListener({ authDir: 'unused', groupId: GROUP_JID, logger: logger as unknown as Logger, onMessage, ...overrides });
  await new Promise((resolve) => setImmediate(resolve));
  return { done, logger, onMessage };
}

/** The error a listener promise rejected with. */
const rejection = (done: Promise<void>) => done.then(
  () => {
    throw new Error('expected the listener to reject');
  },
  (e: Error & { fatal?: boolean }) => e,
);

/** Emits a close event with the given status code on a socket. */
function close(socket: FakeSocket, statusCode: number) {
  socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode } } } });
}

/** A message envelope from the watched group, with `key` fields replaced. */
function envelope(id: string, key: Record<string, unknown> = {}) {
  return { key: { id, remoteJid: GROUP_JID, fromMe: false, ...key }, message: { conversation: `text ${id}` } };
}

/** Runs a socket's messages.upsert handler and waits for it. */
function upsert(socket: FakeSocket, messages: unknown[]) {
  return socket.ev.listeners('messages.upsert')[0]!({ messages, type: 'notify' });
}

beforeEach(() => {
  sockets = [];
  timers = [];
  saveCreds.mockClear();
  generateQr.mockClear();
  const spy = spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms: number) => {
    timers.push({ fn, ms });
    return 0;
  }) as unknown as typeof setTimeout);
  restoreTimeout = () => spy.mockRestore();
});

afterEach(() => {
  restoreTimeout();
});

describe('startListener disconnects', () => {
  test.each([
    ['loggedOut', DisconnectReason.loggedOut],
    ['badSession', DisconnectReason.badSession],
    ['connectionReplaced', DisconnectReason.connectionReplaced],
  ])('rejects as fatal on %s and tears the socket down', async (_name, code) => {
    const { done } = await start();
    const socket = socketAt(0);
    close(socket, code);

    const err = await rejection(done);
    expect(err.fatal).toBe(true);
    expect(err.message).toContain('runner:reset-auth');
    expect(socket.ev.eventNames()).toEqual([]);
    expect(socket.end).toHaveBeenCalledTimes(1);
    expect(sockets).toHaveLength(1);
  });

  test('reconnects at once on restartRequired', async () => {
    await start();
    close(socketAt(0), DisconnectReason.restartRequired);

    expect(sockets).toHaveLength(2);
    expect(timers).toEqual([]);
  });

  test('reconnects with a growing backoff on a plain close', async () => {
    await start();
    close(socketAt(0), DisconnectReason.connectionClosed);
    expect(timers.map((t) => t.ms)).toEqual([3000]);

    fire(0);
    expect(sockets).toHaveLength(2);
    close(socketAt(1), DisconnectReason.connectionClosed);
    expect(timers.map((t) => t.ms)).toEqual([3000, 6000]);
  });

  test('resets the backoff once a connection opens', async () => {
    await start();
    close(socketAt(0), DisconnectReason.connectionClosed);
    fire(0);
    socketAt(1).ev.emit('connection.update', { connection: 'open' });
    close(socketAt(1), DisconnectReason.connectionClosed);

    expect(timers.map((t) => t.ms)).toEqual([3000, 3000]);
  });

  test('rejects without fatal after five failed reconnects', async () => {
    const { done } = await start();
    for (let n = 0; n < 5; n += 1) {
      close(socketAt(n), DisconnectReason.connectionClosed);
      fire(n);
    }
    close(socketAt(5), DisconnectReason.connectionClosed);

    const err = await rejection(done);
    expect(err.fatal).toBeUndefined();
    expect(err.message).toContain('failed 5 times');
    expect(timers).toHaveLength(5);
  });

  test('ignores a second close from the same socket', async () => {
    const { done } = await start();
    const socket = socketAt(0);
    const handler = socket.ev.listeners('connection.update')[0]!;
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
    const socket = socketAt(0);
    socket.ev.removeAllListeners = () => {
      throw new Error('listeners boom');
    };
    socket.end.mockImplementation(() => {
      throw new Error('end boom');
    });
    close(socket, DisconnectReason.loggedOut);

    expect((await rejection(done)).fatal).toBe(true);
    const warnings = logger.warn.mock.calls.map(([fields]) => (fields as { err: string }).err);
    expect(warnings).toEqual(['listeners boom', 'end boom']);
  });
});

describe('startListener events', () => {
  test('passes watched messages to onMessage and skips the rest', async () => {
    const { onMessage } = await start();
    const own = envelope('own', { fromMe: true });
    const other = envelope('other', { remoteJid: 'someone@s.whatsapp.net' });
    const watched = envelope('watched');
    await upsert(socketAt(0), [own, other, watched]);

    expect(onMessage.mock.calls).toEqual([['text watched', watched]]);
  });

  test('accepts every chat when no group is set', async () => {
    const { onMessage } = await start({ groupId: '' });
    await upsert(socketAt(0), [envelope('a', { remoteJid: 'someone@s.whatsapp.net' })]);

    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  test('logs a failing message and carries on with the next', async () => {
    const onMessage = mock(async (text: string, _envelope: unknown) => {
      if (text === 'text bad') throw new Error('handler boom');
    });
    const { logger } = await start({ onMessage });
    await upsert(socketAt(0), [envelope('bad'), envelope('good')]);

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(logger.error.mock.calls[0]?.[0]).toEqual({ err: 'handler boom', messageId: 'bad' });
  });

  test('persists credentials on creds.update', async () => {
    await start();
    socketAt(0).ev.emit('creds.update', { me: {} });

    expect(saveCreds).toHaveBeenCalledTimes(1);
  });

  test('renders a QR code when Baileys sends one', async () => {
    await start();
    socketAt(0).ev.emit('connection.update', { qr: 'qr-payload' });

    expect(generateQr).toHaveBeenCalledWith('qr-payload', { small: true });
    expect(sockets).toHaveLength(1);
  });
});
