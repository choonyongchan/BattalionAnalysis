/**
 * The OpenAI fallback, against a fake `fetch`: no network, no API key.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { describe, expect, test } from 'bun:test';
import { DEFAULT_MODEL, LlmParseError, OpenAiParser } from '../../lib/parser/llm.ts';

const TODAY = '2026-09-18';

/** A minimal extraction the fake model answers with. */
const EXTRACTION = {
  rejected: false,
  rejection_reason: null,
  company: 'Archer',
  date: '2026-09-18',
  session: 'FPS',
  parade_time: '07:25',
  units: [],
  command_team: [],
  personnel: [],
};

/**
 * Builds a fake `fetch` that answers each call with the next reply in turn.
 *
 * @param replies Responses to hand out, or errors to throw, in order.
 * @returns The fake and the request bodies it received.
 */
function fakeFetch(...replies: Array<Response | Error>) {
  const bodies: Array<Record<string, unknown>> = [];
  const impl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const reply = replies.shift() ?? new Error('no more replies');
    if (reply instanceof Error) throw reply;
    return reply;
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

/**
 * A chat-completions reply carrying `content`.
 *
 * @param content The message content.
 * @param finish_reason The finish reason.
 * @returns The response.
 */
function completion(content: string, finish_reason = 'stop'): Response {
  return Response.json({ choices: [{ message: { content }, finish_reason }] });
}

describe('OpenAiParser', () => {
  test('asks gpt-6-luna on the standard tier with the strict schema, and returns its extraction', async () => {
    const { impl, bodies } = fakeFetch(completion(JSON.stringify(EXTRACTION)));
    const parser = new OpenAiParser({ apiKey: 'sk-test', fetchImpl: impl });

    expect(await parser.parse('40 SAR ARCHER COMPANY', TODAY)).toEqual(EXTRACTION as never);
    expect(parser.model).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe('gpt-6-luna');
    expect(bodies[0]).toMatchObject({ model: 'gpt-6-luna', response_format: { type: 'json_schema' } });
    expect(bodies[0]).not.toHaveProperty('service_tier');
    expect(JSON.stringify(bodies[0]!.messages)).toContain('40 SAR ARCHER COMPANY');
  });

  test('retries once, so a single bad reply is not fatal', async () => {
    const { impl, bodies } = fakeFetch(new Response('busy', { status: 503 }), completion(JSON.stringify(EXTRACTION)));
    await new OpenAiParser({ apiKey: 'sk-test', fetchImpl: impl }).parse('text', TODAY);
    expect(bodies).toHaveLength(2);
  });

  test.each([
    ['an HTTP error', () => new Response('no', { status: 401 }), 'HTTP 401'],
    ['a network failure', () => new Error('ECONNRESET'), 'Could not reach'],
    ['a truncated reply', () => completion('{"units":', 'length'), 'truncated'],
    ['a reply that is not JSON', () => completion('sorry'), 'not valid JSON'],
    ['a reply missing an array', () => completion('{"units":[]}'), 'missing one of'],
    ['a refusal', () => Response.json({ choices: [{ message: { refusal: 'no' } }] }), 'refused'],
  ])('throws LlmParseError on %s', async (_, reply, message) => {
    const { impl } = fakeFetch(reply(), reply());
    const parsing = new OpenAiParser({ apiKey: 'sk-test', fetchImpl: impl }).parse('text', TODAY);
    await expect(parsing).rejects.toBeInstanceOf(LlmParseError);
    await expect(parsing).rejects.toThrow(message);
  });

  test('is built from the environment only when a key is set', () => {
    expect(OpenAiParser.fromEnv({})).toBeNull();
    expect(OpenAiParser.fromEnv({ OPENAI_API_KEY: 'sk-test' })?.model).toBe('gpt-6-luna');
    expect(OpenAiParser.fromEnv({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-other' })?.model).toBe('gpt-other');
  });
});
