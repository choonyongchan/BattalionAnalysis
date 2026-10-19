/**
 * Tests for the non-network parts of the ingestor: config validation, the
 * Baileys envelope filters, and the end-to-end message handler.
 */

import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../../runner/src/config.ts';
import { extractText, isWatchedGroupMessage } from '../../runner/src/listener.ts';
import { createMessageHandler } from '../../runner/src/index.ts';
import type { IntakeOutcome } from '../../runner/src/ingest.ts';
import type { WAMessage } from '@whiskeysockets/baileys';

/** A marker standing in for a name/NRIC that must never reach a log. */
const MARKER = 'NRIC S0000000Z BODY';

/** JID used as the watched group in the envelope tests. */
const GROUP_JID = '120363000000000000@g.us';

/** A complete environment for loadConfig, passed explicitly because `.env.whatsapp` is already in process.env. */
function sampleEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    WA_GROUP_ID: GROUP_JID,
    PARADE_API_URL: 'https://example.vercel.app/api/parade',
    PARADE_INGEST_SECRET: 'relay-secret',
    ...overrides,
  };
}

/** A logger stub that records nothing. */
const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

/** A minimal envelope carrying only a message id. */
const withId = (id: string) => ({ key: { id } }) as WAMessage;

describe('loadConfig', () => {
  test('reads the required settings', () => {
    const config = loadConfig({ env: sampleEnv() });
    expect(config.groupId).toBe(GROUP_JID);
    expect(config.paradeApiUrl).toBe('https://example.vercel.app/api/parade');
    expect(config.ingestSecret).toBe('relay-secret');
    expect(config.dryRun).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  test.each(['WA_GROUP_ID', 'PARADE_API_URL', 'PARADE_INGEST_SECRET'])('rejects a missing %s', (key) => {
    const env = sampleEnv();
    delete env[key];
    expect(() => loadConfig({ env })).toThrow(new RegExp(key));
  });

  test('allows a blank WA_GROUP_ID only in a dry run', () => {
    expect(loadConfig({ env: sampleEnv({ WA_GROUP_ID: '', DRY_RUN: '1' }) }).groupId).toBe('');
    expect(() => loadConfig({ env: sampleEnv({ WA_GROUP_ID: '' }) })).toThrow(/WA_GROUP_ID/);
  });

  test('rejects a blank required setting, not just an absent one', () => {
    expect(() => loadConfig({ env: sampleEnv({ PARADE_INGEST_SECRET: '   ' }) })).toThrow(/PARADE_INGEST_SECRET/);
  });

  test('honours DRY_RUN', () => {
    expect(loadConfig({ env: sampleEnv({ DRY_RUN: '1' }) }).dryRun).toBe(true);
    expect(loadConfig({ env: sampleEnv({ DRY_RUN: '0' }) }).dryRun).toBe(false);
  });

  test('honours LOG_LEVEL', () => {
    expect(loadConfig({ env: sampleEnv({ LOG_LEVEL: 'debug' }) }).logLevel).toBe('debug');
  });
});


describe('listener envelope filters', () => {
  /** A minimal inbound group envelope, with `key` fields or `message` replaced. */
  function envelope(overrides: { key?: Partial<WAMessage['key']>; message?: WAMessage['message'] } = {}): WAMessage {
    return {
      key: { id: 'MSG1', remoteJid: GROUP_JID, fromMe: false, ...overrides.key },
      message: overrides.message === undefined ? { conversation: 'hello' } : overrides.message,
    };
  }

  test('reads every supported text field', () => {
    expect(extractText({ conversation: 'a' })).toBe('a');
    expect(extractText({ extendedTextMessage: { text: 'b' } })).toBe('b');
    expect(extractText({ imageMessage: { caption: 'c' } })).toBe('c');
    expect(extractText(null)).toBeNull();
    expect(extractText({ protocolMessage: {} })).toBeNull();
  });

  test('accepts an inbound text message from the group', () => {
    expect(isWatchedGroupMessage(envelope(), GROUP_JID)).toBe(true);
  });

  test("rejects the bridge's own messages", () => {
    expect(isWatchedGroupMessage(envelope({ key: { fromMe: true } }), GROUP_JID)).toBe(false);
  });

  test('rejects other chats', () => {
    expect(isWatchedGroupMessage(envelope({ key: { remoteJid: 'other@g.us' } }), GROUP_JID)).toBe(false);
  });

  test('rejects messages without text', () => {
    expect(isWatchedGroupMessage(envelope({ message: { protocolMessage: {} } }), GROUP_JID)).toBe(false);
  });
});

describe('createMessageHandler', () => {
  /** An ingestor that records what it was given. */
  function fakeIngestor(impl: () => Promise<IntakeOutcome> = async () => ({ status: 'parsed', id: 1 })) {
    const calls: [string, string][] = [];
    return {
      calls,
      ingest: async (text: string, messageId: string) => {
        calls.push([text, messageId]);
        return impl();
      },
    };
  }

  /** A minimal first parade state that clears every signature gate. */
  const PARADE_STATE = [
    'HERCULES COMPANY FIRST PARADE STATE',
    'DATE: 220626 @ 0730 Hrs',
    '',
    'TOTAL STRENGTH: 136',
    'CURRENT STRENGTH: 120',
    'PLATOON 1: 51/55',
    'PLATOON 2: 49/56',
    'COMMANDERS: 20/25',
    '[OFFICER]: 05/07',
    'CDO: 2LT RYAN',
    'CDS: 3SG DENNIS TAN',
    'Padding line to clear the character gate comfortably for this test case.',
  ].join('\n');

  test('ingests an accepted parade state with its message id', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });
    await handle(PARADE_STATE, withId('MSG1'));

    expect(ingestor.calls).toHaveLength(1);
    expect(ingestor.calls[0]?.[1]).toBe('MSG1');
    expect(ingestor.calls[0]?.[0]).toContain('PARADE STATE');
  });

  test.each([
    ['parsed', 'info', 'parade state stored and parsed'],
    ['already_parsed', 'info', 'parade state already known'],
    ['needs_review', 'warn', 'parade state stored; needs correcting on the dashboard'],
    ['rejected', 'warn', 'parade state rejected by the parser'],
  ])('logs a %s answer at %s', async (status, level, message) => {
    const logged: (string | undefined)[] = [];
    const capturingLogger = { ...silentLogger, [level as string]: (_fields: unknown, msg?: string) => logged.push(msg) };
    const handle = createMessageHandler({
      config: { dryRun: false },
      logger: capturingLogger,
      ingestor: fakeIngestor(async () => ({ status: status as string, id: 1 })),
    });

    await handle(PARADE_STATE, withId('MSG1'));

    expect(logged).toEqual([message]);
  });

  test('never ingests a rejected message', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });
    await handle('Why is your parade state late?', withId('MSG2'));

    expect(ingestor.calls).toHaveLength(0);
  });

  test('ingests nothing in DRY_RUN', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: true }, logger: silentLogger, ingestor });
    await handle(PARADE_STATE, withId('MSG3'));

    expect(ingestor.calls).toHaveLength(0);
  });

  test('swallows a storage failure so one bad message cannot stop the listener', async () => {
    const ingestor = fakeIngestor(async () => {
      throw new Error('neon unreachable');
    });
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });

    expect(await handle(PARADE_STATE, withId('MSG4'))).toBeUndefined();
  });

  test('never logs the problems or reason the intake quotes back', async () => {
    const logged: unknown[] = [];
    const capturingLogger = { ...silentLogger, warn: (fields: unknown, msg?: string) => logged.push([fields, msg]) };
    const ingestor = fakeIngestor(async () => ({ status: 'needs_review', id: 7, problems: [MARKER], reason: MARKER }) as IntakeOutcome);
    const handle = createMessageHandler({ config: { dryRun: false }, logger: capturingLogger, ingestor });

    await handle(PARADE_STATE, withId('MSG5'));

    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(MARKER);
  });
});
