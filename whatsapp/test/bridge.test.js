/**
 * Tests for the non-network parts of the bridge: config validation, the Apps
 * Script client's URL/payload helpers and its response handling, the Baileys
 * envelope filters, and the end-to-end message handler.
 *
 * The relay itself is covered here with a stubbed global fetch. Its predecessor
 * (the Google Form submitter) was never tested at all, so the outcome-handling
 * branches — a non-2xx, and the 200-with-ok:false that ContentService forces —
 * had no coverage.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { loadConfig } from '../src/config.js';
import { buildIntakeUrl, relayParadeState } from '../src/appsScriptClient.js';
import { extractText, isWatchedGroupMessage } from '../src/listener.js';
import { createMessageHandler } from '../src/index.js';

/** @type {string} JID used as the watched group in the envelope tests. */
const GROUP_JID = '120363000000000000@g.us';

/** @type {string} Stand-in web app URL. */
const EXEC_URL = 'https://script.google.com/macros/s/AKfycb-test/exec';

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

describe('appsScriptClient helpers', () => {
  test('appends the route parameter', () => {
    expect(buildIntakeUrl(EXEC_URL)).toBe(`${EXEC_URL}?route=paradestate`);
  });

  test('uses & when the URL already carries a query string', () => {
    expect(buildIntakeUrl(`${EXEC_URL}?v=2`)).toBe(`${EXEC_URL}?v=2&route=paradestate`);
  });

});

describe('relayParadeState', () => {
  /** @type {typeof fetch} The real fetch, restored after each test. */
  let realFetch;
  /** @type {!Array<!Array<*>>} Every call the stub received. */
  let calls;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    calls = [];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /**
   * Installs a fetch stub returning one canned response.
   *
   * @param {{ok?: boolean, status?: number, body?: !Object}} response The reply to serve.
   * @returns {void}
   */
  function stubFetch({ ok = true, status = 200, body = { ok: true, appended: true, rowIndex: 7 } }) {
    globalThis.fetch = async (url, init) => {
      calls.push([url, init]);
      return { ok, status, json: async () => body };
    };
  }

  const config = { appsScriptUrl: EXEC_URL, appsScriptToken: 'tok' };

  test('posts JSON to the routed URL and reports the row', async () => {
    stubFetch({});
    const result = await relayParadeState('PARADE STATE', 'MSG1', config);

    expect(result).toEqual({ appended: true, rowIndex: 7 });
    const [url, init] = calls[0];
    expect(url).toBe(`${EXEC_URL}?route=paradestate`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ token: 'tok', messageId: 'MSG1', text: 'PARADE STATE' });
  });

  test('reports a duplicate as not appended rather than as a failure', async () => {
    stubFetch({ body: { ok: true, appended: false, rowIndex: 3 } });
    expect(await relayParadeState('PARADE STATE', 'MSG1', config)).toEqual({ appended: false, rowIndex: 3 });
  });

  test('throws on a non-2xx response', async () => {
    stubFetch({ ok: false, status: 500 });
    expect(relayParadeState('PARADE STATE', 'MSG1', config)).rejects.toThrow(/HTTP 500/);
  });

  test('throws on a 200 that reports a rejection', async () => {
    // ContentService cannot set a status code, so a rejection arrives as 200
    // with ok:false. Treating that as success would lose the message silently.
    stubFetch({ body: { ok: false, error: 'unauthorised' } });
    expect(relayParadeState('PARADE STATE', 'MSG1', config)).rejects.toThrow(/unauthorised/);
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
  /** @type {typeof fetch} The real fetch, restored after each test. */
  let realFetch;

  beforeEach(() => {
    realFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

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

  test('relays an accepted parade state with its message id', async () => {
    /** @type {!Array<!Object>} */
    const bodies = [];
    globalThis.fetch = async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, appended: true, rowIndex: 4 }) };
    };

    const handle = createMessageHandler({
      config: { dryRun: false, appsScriptUrl: EXEC_URL, appsScriptToken: 'tok' },
      logger: silentLogger,
    });
    await handle(PARADE_STATE, { key: { id: 'MSG1' } });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].messageId).toBe('MSG1');
    expect(bodies[0].text).toContain('PARADE STATE');
  });

  test('never relays a rejected message', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const handle = createMessageHandler({
      config: { dryRun: false, appsScriptUrl: EXEC_URL, appsScriptToken: 'tok' },
      logger: silentLogger,
    });
    await handle('Why is your parade state late?', { key: { id: 'MSG2' } });

    expect(called).toBe(false);
  });

  test('relays nothing in DRY_RUN', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    };

    const handle = createMessageHandler({
      config: { dryRun: true, appsScriptUrl: EXEC_URL, appsScriptToken: 'tok' },
      logger: silentLogger,
    });
    await handle(PARADE_STATE, { key: { id: 'MSG3' } });

    expect(called).toBe(false);
  });

  test('swallows a relay failure so one bad message cannot stop the listener', async () => {
    globalThis.fetch = async () => {
      throw new Error('network down');
    };

    const handle = createMessageHandler({
      config: { dryRun: false, appsScriptUrl: EXEC_URL, appsScriptToken: 'tok' },
      logger: silentLogger,
    });

    expect(await handle(PARADE_STATE, { key: { id: 'MSG4' } })).toBeUndefined();
  });
});
