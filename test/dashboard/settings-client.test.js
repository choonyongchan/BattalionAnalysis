/**
 * The browser's settings calls: what reaches the server, and the sentence a refusal becomes.
 * `fetch` is replaced for each test; nothing leaves the process.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { refreshMs, resetSection, saveSection, unitSettings } from '../../src/data/settings.js';
import { resetActiveSettings, setActiveSettings } from '../../src/model/settings/active.js';
import { defaultSettings } from '../../src/model/settings/resolve.js';

const realFetch = globalThis.fetch;

/**
 * Replaces fetch with one that records the call and answers with the given status and body.
 * @param {number} status HTTP status.
 * @param {!Object} body JSON body.
 * @returns {!Array<!Object>} The recorded calls.
 */
function answer(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveSettings();
});

describe('saveSection', () => {
  test('PUTs the section, value and version, and returns the new version', async () => {
    const calls = answer(200, { ok: true, version: 2, warnings: [] });
    expect(await saveSection('unit', { name: 'x' }, 1)).toEqual({ version: 2, warnings: [] });
    expect(calls[0].url).toBe('/api/settings');
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(calls[0].init.body)).toEqual({ section: 'unit', value: { name: 'x' }, version: 1 });
  });

  test('a 422 carries the field errors; a 409 says someone else saved', async () => {
    answer(422, { ok: false, error: 'invalid', errors: [{ path: 'name', message: 'Enter a name.' }] });
    const invalid = await saveSection('unit', {}, 0).catch((error) => error);
    expect(invalid.status).toBe(422);
    expect(invalid.errors).toEqual([{ path: 'name', message: 'Enter a name.' }]);

    answer(409, { ok: false, error: 'conflict' });
    const conflict = await saveSection('unit', {}, 0).catch((error) => error);
    expect(conflict.message).toContain('Someone else saved');
  });
});

describe('resetSection', () => {
  test('DELETEs with the section and version in the query', async () => {
    const calls = answer(200, { ok: true, version: 0 });
    await resetSection('calendar', 3);
    expect(calls[0].url).toBe('/api/settings?section=calendar&version=3');
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('settings the app shell reads', () => {
  test('unitSettings and refreshMs follow the active settings', () => {
    expect(unitSettings().name).toBe('40 SAR');
    expect(refreshMs()).toBe(60000);
    const values = defaultSettings();
    values.unit = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };
    values.session = { ttlHours: 12, refreshSeconds: 120 };
    setActiveSettings(values);
    expect(unitSettings().name).toBe('41 SAR');
    expect(refreshMs()).toBe(120000);
  });
});
