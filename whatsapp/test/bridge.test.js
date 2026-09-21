/**
 * Tests for the non-network parts of the ingestor: config validation, the
 * Baileys envelope filters, and the end-to-end message handler.
 */

import { describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config.js';
import { extractText, isWatchedGroupMessage } from '../src/listener.js';
import { createMessageHandler } from '../src/index.js';
import { DrizzleQueryError } from '../../node_modules/drizzle-orm/errors.js';

/** @type {string} A marker standing in for a name/NRIC that must never reach a log. */
const MARKER = 'NRIC S1234568B BODY';

/** @type {string} JID used as the watched group in the envelope tests. */
const GROUP_JID = '120363000000000000@g.us';

/**
 * A complete environment for loadConfig, so a test can vary one key at a time.
 *
 * Passed in explicitly rather than set on process.env: whatsapp/.env is loaded
 * into process.env as a side effect that a test cannot undo, so a populated
 * .env on the developer's machine used to override whatever the test set.
 *
 * @param {!Object<string, string>=} overrides Keys to merge over the defaults.
 * @returns {!Object<string, string>} An environment object.
 */
function sampleEnv(overrides = {}) {
  return {
    WA_GROUP_ID: GROUP_JID,
    DATABASE_URL: 'postgresql://parade_ingest:pw@host/db?sslmode=require',
    OPENAI_API_KEY: 'sk-test',
    ...overrides,
  };
}

/** @type {import('pino').Logger} A logger stub that records nothing. */
const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };

describe('loadConfig', () => {
  test('reads the required settings', () => {
    const config = loadConfig({ env: sampleEnv() });
    expect(config.groupId).toBe(GROUP_JID);
    expect(config.databaseUrl).toContain('parade_ingest');
    expect(config.openaiApiKey).toBe('sk-test');
    expect(config.openaiModel).toBeUndefined();
    expect(config.parseIntervalMs).toBe(300_000);
    expect(config.dryRun).toBe(false);
    expect(config.logLevel).toBe('info');
  });

  test.each(['WA_GROUP_ID', 'DATABASE_URL', 'OPENAI_API_KEY'])('rejects a missing %s', (key) => {
    const env = sampleEnv();
    delete env[key];
    expect(() => loadConfig({ env })).toThrow(new RegExp(key));
  });

  test('rejects a blank required setting, not just an absent one', () => {
    expect(() => loadConfig({ env: sampleEnv({ OPENAI_API_KEY: '   ' }) })).toThrow(/OPENAI_API_KEY/);
  });

  test('honours OPENAI_MODEL and PARSE_INTERVAL_MS', () => {
    const config = loadConfig({ env: sampleEnv({ OPENAI_MODEL: 'gpt-x', PARSE_INTERVAL_MS: '60000' }) });
    expect(config.openaiModel).toBe('gpt-x');
    expect(config.parseIntervalMs).toBe(60_000);
  });

  test('rejects a PARSE_INTERVAL_MS that is not a positive number', () => {
    expect(() => loadConfig({ env: sampleEnv({ PARSE_INTERVAL_MS: 'soon' }) })).toThrow(/PARSE_INTERVAL_MS/);
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
  /**
   * Builds a minimal Baileys envelope.
   *
   * @param {Object} overrides Fields to override on the default envelope.
   * @returns {Object} The envelope.
   */
  function envelope(overrides = {}) {
    return {
      key: { id: 'MSG1', remoteJid: GROUP_JID, fromMe: false, ...(overrides.key || {}) },
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
  // The existing `/** @type {string} */ const PARADE_STATE = [...]` declaration stays here
  // exactly as it is today; only the blocks around it change.

  /**
   * An ingestor that records what it was given.
   *
   * @param {function(): !Promise<Object>=} impl Replaces the default outcome.
   * @returns {{calls: !Array<!Array<string>>, ingest: function(string, string): !Promise<Object>}}
   */
  function fakeIngestor(impl = async () => ({ status: 'stored', id: 1 })) {
    const calls = [];
    return {
      calls,
      ingest: async (text, messageId) => {
        calls.push([text, messageId]);
        return impl();
      },
    };
  }

  /**
   * A minimal well-formed first parade state: enough signals and bulk to clear every
   * signature gate, standing in for a real sample so these tests need no external corpus.
   * @type {string}
   */
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
    await handle(PARADE_STATE, { key: { id: 'MSG1' } });

    expect(ingestor.calls).toHaveLength(1);
    expect(ingestor.calls[0][1]).toBe('MSG1');
    expect(ingestor.calls[0][0]).toContain('PARADE STATE');
  });

  test('never ingests a rejected message', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });
    await handle('Why is your parade state late?', { key: { id: 'MSG2' } });

    expect(ingestor.calls).toHaveLength(0);
  });

  test('ingests nothing in DRY_RUN', async () => {
    const ingestor = fakeIngestor();
    const handle = createMessageHandler({ config: { dryRun: true }, logger: silentLogger, ingestor });
    await handle(PARADE_STATE, { key: { id: 'MSG3' } });

    expect(ingestor.calls).toHaveLength(0);
  });

  test('swallows a storage failure so one bad message cannot stop the listener', async () => {
    const ingestor = fakeIngestor(async () => {
      throw new Error('neon unreachable');
    });
    const handle = createMessageHandler({ config: { dryRun: false }, logger: silentLogger, ingestor });

    expect(await handle(PARADE_STATE, { key: { id: 'MSG4' } })).toBeUndefined();
  });

  test('never logs a DrizzleQueryError message or params from a storage failure', async () => {
    const logged = [];
    const capturingLogger = { ...silentLogger, error: (fields, msg) => logged.push([fields, msg]) };
    const ingestor = fakeIngestor(async () => {
      throw new DrizzleQueryError('insert into raw_messages (body) values ($1)', [MARKER], new Error('fetch failed'));
    });
    const handle = createMessageHandler({ config: { dryRun: false }, logger: capturingLogger, ingestor });

    await handle(PARADE_STATE, { key: { id: 'MSG5' } });

    expect(logged).toHaveLength(1);
    expect(JSON.stringify(logged)).not.toContain(MARKER);
  });
});
