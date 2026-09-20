/**
 * The model call, against a stubbed fetch.
 *
 * The distinction these tests exist to protect is `transient`. It decides whether the
 * intake answers 5xx (so the bridge resends and the message is recovered) or records a
 * permanent failure against the message (so it stops costing money). Getting it backwards
 * either loses parade states or retries a doomed request forever.
 */
import { describe, expect, test } from 'bun:test';
import { ExtractionError, extract } from '../../lib/parser/extract.ts';

/** A minimal valid model answer. */
const VALID_CONTENT = JSON.stringify({
  rejected: false,
  rejection_reason: null,
  company: 'Archer',
  date: '2026-09-18',
  session: 'FPS',
  parade_time: '07:25',
  units: [],
  command_team: [],
  personnel: [],
});

/**
 * Builds a stub fetch returning a sequence of canned responses.
 *
 * @param responses One entry per expected call.
 * @returns A fetch implementation plus the recorded calls.
 */
function stubFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let index = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    // Cloned because a Response body can only be read once, and the retry path reads the
    // same canned response a second time.
    return next!.clone();
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/**
 * Builds a successful chat-completions response.
 *
 * @param content The JSON string the model "returned".
 * @param finishReason Optional finish reason.
 * @returns A Response.
 */
function ok(content: string, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const options = { apiKey: 'test-key', today: '2026-09-18' };

describe('a successful extraction', () => {
  test('returns the parsed answer', async () => {
    const { impl } = stubFetch([ok(VALID_CONTENT)]);
    const result = await extract('40 SAR ARCHER COMPANY', { ...options, fetchImpl: impl });
    expect(result.company).toBe('Archer');
    expect(result.rejected).toBe(false);
  });

  test('sends the key, the model, flex tier and a strict schema', async () => {
    const { impl, calls } = stubFetch([ok(VALID_CONTENT)]);
    await extract('text', { ...options, model: 'a-model', fetchImpl: impl });

    const [call] = calls;
    expect(call!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect((call!.init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');

    const body = JSON.parse(call!.init.body as string);
    expect(body.model).toBe('a-model');
    expect(body.service_tier).toBe('flex');
    expect(body.response_format.type).toBe('json_schema');
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  test('puts the message into the prompt', async () => {
    const { impl, calls } = stubFetch([ok(VALID_CONTENT)]);
    await extract('40 SAR HERCULES COMPANY', { ...options, fetchImpl: impl });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.messages[0].content).toContain('40 SAR HERCULES COMPANY');
  });

  test('makes only one call when the first succeeds', async () => {
    const { impl, calls } = stubFetch([ok(VALID_CONTENT)]);
    await extract('text', { ...options, fetchImpl: impl });
    expect(calls).toHaveLength(1);
  });

  test('passes a rejection through rather than treating it as a failure', async () => {
    const rejected = JSON.stringify({
      rejected: true,
      rejection_reason: 'This is a LAST PARADE STATE.',
      company: 'Cougar',
      date: null,
      session: 'LPS',
      parade_time: null,
      units: [],
      command_team: [],
      personnel: [],
    });
    const { impl } = stubFetch([ok(rejected)]);
    const result = await extract('text', { ...options, fetchImpl: impl });
    expect(result.rejected).toBe(true);
    expect(result.rejection_reason).toMatch(/LAST PARADE STATE/);
  });
});

describe('retrying', () => {
  test('tries a second time after a transient failure', async () => {
    const { impl, calls } = stubFetch([new Response('boom', { status: 503 }), ok(VALID_CONTENT)]);
    const result = await extract('text', { ...options, fetchImpl: impl });
    expect(result.company).toBe('Archer');
    expect(calls).toHaveLength(2);
  });

  test('gives up after two attempts', async () => {
    const { impl, calls } = stubFetch([new Response('boom', { status: 503 })]);
    await expect(extract('text', { ...options, fetchImpl: impl })).rejects.toThrow(ExtractionError);
    expect(calls).toHaveLength(2);
  });
});

describe('failures are classified so the caller knows whether to retry', () => {
  /**
   * Runs an extraction expected to fail.
   *
   * @param responses Stub responses.
   * @returns The thrown ExtractionError.
   */
  async function failure(responses: Array<Response | Error>): Promise<ExtractionError> {
    const { impl } = stubFetch(responses);
    try {
      await extract('text', { ...options, fetchImpl: impl });
    } catch (error) {
      return error as ExtractionError;
    }
    throw new Error('expected the extraction to fail');
  }

  test('a network fault is transient', async () => {
    const error = await failure([new TypeError('network down')]);
    expect(error.transient).toBe(true);
  });

  test('a 5xx is transient', async () => {
    expect((await failure([new Response('', { status: 500 })])).transient).toBe(true);
  });

  test('a 429 is transient, since flex-tier capacity comes back', async () => {
    expect((await failure([new Response('', { status: 429 })])).transient).toBe(true);
  });

  test('a 401 is permanent -- a bad key does not fix itself', async () => {
    const error = await failure([new Response('bad key', { status: 401 })]);
    expect(error.transient).toBe(false);
    expect(error.message).toContain('401');
  });

  test('a 404 is permanent, which is what a withdrawn model looks like', async () => {
    expect((await failure([new Response('no model', { status: 404 })])).transient).toBe(false);
  });

  test('content that is not JSON is permanent', async () => {
    const error = await failure([ok('not json at all')]);
    expect(error.transient).toBe(false);
    expect(error.message).toMatch(/not valid JSON/);
  });

  test('a missing array is permanent, since the schema itself is wrong', async () => {
    const error = await failure([ok(JSON.stringify({ rejected: false, units: [] }))]);
    expect(error.transient).toBe(false);
    expect(error.message).toMatch(/missing one of/);
  });

  test('an empty choice list is transient', async () => {
    const empty = new Response(JSON.stringify({ choices: [] }), { status: 200 });
    expect((await failure([empty])).transient).toBe(true);
  });

  test('a truncated response is transient, not silently half-parsed', async () => {
    const error = await failure([ok(VALID_CONTENT, 'length')]);
    expect(error.transient).toBe(true);
    expect(error.message).toMatch(/truncated/);
  });
});
