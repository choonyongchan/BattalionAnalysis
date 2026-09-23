/**
 * The model fallback: reads a parade state the rule-based parser in `deterministic.ts` was
 * unsure of, through OpenAI's chat-completions endpoint with Structured Outputs.
 *
 * Raw `fetch` rather than the `openai` SDK: the call is one POST with a JSON body, and the SDK
 * would add a dependency and a mocking surface. `fetchImpl` is injectable so tests run
 * without a network.
 */
import type { Extraction } from './extraction.ts';
import { buildPrompt } from './prompt.ts';
import { buildResponseSchema } from './schema.ts';

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

/** The model, overridable by env; whichever is used is recorded on `parade_submissions.model`. */
export const DEFAULT_MODEL = 'gpt-6-luna';

/** How many times to call before giving up. A truncated or empty reply may not recur. */
const MAX_ATTEMPTS = 2;

/** How long one call may take. Two of them fit inside the intake's 300 s function limit. */
const ATTEMPT_TIMEOUT_MS = 120_000;

/** Raised when the model could not be made to return a usable extraction. */
export class LlmParseError extends Error {
  /**
   * @param message What went wrong, without the message text.
   */
  constructor(message: string) {
    super(message);
    this.name = 'LlmParseError';
  }
}

/** What `OpenAiParser` needs. */
export interface OpenAiParserOptions {
  /** The OpenAI API key. */
  apiKey: string;
  /** The model; defaults to `DEFAULT_MODEL`. */
  model?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Reads parade states with an OpenAI model, on the standard (not flex) service tier.
 *
 * Attributes:
 *   model: The model id each call uses, recorded against the rows it produces.
 */
export class OpenAiParser {
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  /**
   * @param options The API key, and optional model and fetch overrides.
   */
  constructor(options: OpenAiParserOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model || DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * Builds a parser from the environment.
   *
   * @param env The environment; `OPENAI_API_KEY` is required, `OPENAI_MODEL` optional.
   * @returns The parser, or null when no API key is configured.
   */
  static fromEnv(env: Record<string, string | undefined> = process.env): OpenAiParser | null {
    return env.OPENAI_API_KEY ? new OpenAiParser({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL }) : null;
  }

  /**
   * Extracts a parade state from message text.
   *
   * @param text The message, already passed through `cleanText`.
   * @param today The receipt date, `yyyy-MM-dd`, for resolving two-digit years.
   * @returns The extraction, which may be a rejection (`rejected: true`).
   * @throws {LlmParseError} When every attempt fails.
   */
  async parse(text: string, today: string): Promise<Extraction> {
    const body = JSON.stringify({
      model: this.model,
      messages: [{ role: 'user', content: buildPrompt(text, today) }],
      response_format: { type: 'json_schema', json_schema: buildResponseSchema() },
    });

    let last: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.callOnce(body);
      } catch (error) {
        last = error;
      }
    }
    throw last instanceof LlmParseError ? last : new LlmParseError(String(last));
  }

  /**
   * Makes one request and reads the reply.
   *
   * @param body The serialised request body.
   * @returns The extraction.
   * @throws {LlmParseError} On any transport, status or shape failure.
   */
  private async callOnce(body: string): Promise<Extraction> {
    let response: Response;
    try {
      response = await this.fetchImpl(CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
    } catch (error) {
      throw new LlmParseError(`Could not reach the model API: ${String(error)}`);
    }
    if (!response.ok) {
      throw new LlmParseError(`Model API returned HTTP ${response.status}: ${(await safeText(response)).slice(0, 500)}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; refusal?: string }; finish_reason?: string }>;
    };
    return readExtraction(payload.choices?.[0]);
  }
}

/**
 * Checks what Structured Outputs cannot guarantee: that a whole JSON answer came back.
 *
 * @param choice The first choice of the reply.
 * @returns The extraction.
 * @throws {LlmParseError} When the reply is empty, refused, truncated, not JSON or missing an array.
 */
function readExtraction(
  choice: { message?: { content?: string; refusal?: string }; finish_reason?: string } | undefined,
): Extraction {
  if (choice?.message?.refusal) throw new LlmParseError(`Model refused: ${choice.message.refusal}`);
  if (!choice?.message?.content) throw new LlmParseError('Model API returned no content.');
  if (choice.finish_reason === 'length') throw new LlmParseError('Model response was truncated before the JSON ended.');

  let parsed: Extraction;
  try {
    parsed = JSON.parse(choice.message.content) as Extraction;
  } catch {
    throw new LlmParseError('Model returned content that is not valid JSON.');
  }
  if (!Array.isArray(parsed.units) || !Array.isArray(parsed.command_team) || !Array.isArray(parsed.personnel)) {
    throw new LlmParseError('Model response is missing one of units, command_team or personnel.');
  }
  return parsed;
}

/**
 * Reads a failed response's body without letting a decode failure mask the real error.
 *
 * @param response The failed response.
 * @returns The body text, or a placeholder when it cannot be read.
 */
async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '(response body unreadable)';
  }
}
