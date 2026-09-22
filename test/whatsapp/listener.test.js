/**
 * Tests for the listener's reconnect decision helpers.
 *
 * The socket lifecycle itself needs a live WhatsApp connection, so it is not
 * covered here; these are the pure functions that decide whether a disconnect
 * is fatal and how long to wait before the next attempt.
 */

import { describe, expect, test } from 'bun:test';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { classifyDisconnect, reconnectDelayMs } from '../../whatsapp/src/listener.js';

describe('classifyDisconnect', () => {
  test('treats a logged-out session as fatal', () => {
    expect(classifyDisconnect(DisconnectReason.loggedOut)).toBe('fatal');
  });

  test('treats a bad session as fatal', () => {
    expect(classifyDisconnect(DisconnectReason.badSession)).toBe('fatal');
  });

  test('treats a replaced connection as fatal', () => {
    expect(classifyDisconnect(DisconnectReason.connectionReplaced)).toBe('fatal');
  });

  test('treats restartRequired as an immediate restart', () => {
    expect(classifyDisconnect(DisconnectReason.restartRequired)).toBe('restart');
  });

  test('treats a plain connection close as a retry', () => {
    expect(classifyDisconnect(DisconnectReason.connectionClosed)).toBe('retry');
  });

  test('treats an unknown status code as a retry', () => {
    expect(classifyDisconnect(undefined)).toBe('retry');
  });
});

describe('reconnectDelayMs', () => {
  test('starts at the base delay', () => {
    expect(reconnectDelayMs(1)).toBe(3000);
  });

  test('doubles each attempt', () => {
    expect(reconnectDelayMs(2)).toBe(6000);
    expect(reconnectDelayMs(3)).toBe(12000);
  });

  test('is capped at the ceiling', () => {
    expect(reconnectDelayMs(6)).toBe(96000);
    expect(reconnectDelayMs(7)).toBe(120000);
    expect(reconnectDelayMs(99)).toBe(120000);
  });
});
