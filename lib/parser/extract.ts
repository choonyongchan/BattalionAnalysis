/**
 * The model call.
 *
 * Raw `fetch` against the chat-completions endpoint rather than the `openai` SDK: the call
 * is one POST with a JSON body, the SDK would add a dependency and a mocking surface, and
 * the Apps Script original was already plain HTTP. `fetchImpl` is a parameter so every test
 * runs without a network.
 *
 * Structured Outputs does the schema enforcement, so there is no hand-written shape
 * validation of individual fields here -- only the checks the API cannot make for us: that
 * a choice came back at all, that its content is JSON, and that the three arrays exist.
 */
import { buildPrompt } from './prompt.ts';
import { buildResponseSchema } from './schema.ts';

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * The model to extract with.
 *
 * Overridable by env so a model change is a deployment setting rather than a code change,
 * which matters because the extraction prompt is tuned against a specific model's
 * behaviour: changing it silently changes what lands in the database. Whichever model is
 * used is recorded on `parade_submissions.model`, so a surprising row can be traced to the
 * run that produced it.
 */
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';

/** How many times to call before giving up. The second attempt costs less than a lost message. */
const MAX_ATTEMPTS = 2;

/** A unit strength block as the model returns it. */
export interface ExtractedUnit {
  unit_label: string;
  total_strength: number | null;
  total_present: number | null;
  officer_strength: number | null;
  officer_present: number | null;
  wospec_strength: number | null;
  wospec_present: number | null;
  enlistee_strength: number | null;
  enlistee_present: number | null;
  section_counts: Array<{ reason_category: string; stated_count: number | null }>;
}

/** A command appointment as the model returns it. */
export interface ExtractedCommandMember {
  role_kind: string;
  unit_label: string | null;
  rank: string | null;
  name: string | null;
  is_vacant: boolean;
}

/** One entry line as the model returns it. */
export interface ExtractedPerson {
  unit_label: string;
  entry_index: number | null;
  reason_category: string;
  four_d: string | null;
  rank: string | null;
  name: string;
  duty_type: string | null;
  sub_reason: string | null;
  report_sick_type: string | null;
  num_days: number | null;
  is_permanent: boolean;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  in_camp: boolean | null;
  location: string | null;
  source_line: string | null;
}

/** A whole extracted message. */
export interface Extraction {
  rejected: boolean;
  rejection_reason: string | null;
  company: string | null;
  date: string | null;
  session: string | null;
  parade_time: string | null;
  units: ExtractedUnit[];
  command_team: ExtractedCommandMember[];
  personnel: ExtractedPerson[];
}

/** What `extract` needs from its caller. */
export interface ExtractOptions {
  apiKey: string;
  /** The date the message arrived, `yyyy-MM-dd`, for resolving implausible years. */
  today: string;
  model?: string;
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Raised when the model could not be made to return a usable answer. */
export class ExtractionError extends Error {
  /** True when retrying later might succeed: a network fault or a 5xx. */
  readonly transient: boolean;

  constructor(message: string, transient: boolean) {
    super(message);
    this.name = 'ExtractionError';
    this.transient = transient;
  }
}

/**
 * Extracts a parade state from raw message text.
 *
 * @param text The message, already passed through `cleanText`.
 * @param options API key, arrival date, and optional model and fetch overrides.
 * @returns The extraction, which may be a rejection (`rejected: true`).
 * @throws {ExtractionError} When both attempts fail. `transient` says whether a later retry
 *   could succeed, which decides whether the caller answers 5xx or records a permanent
 *   failure against the message.
 */
export async function extract(text: string, options: ExtractOptions): Promise<Extraction> {
  const model = options.model || DEFAULT_MODEL;
  const doFetch = options.fetchImpl || fetch;
  const body = JSON.stringify({
    model,
    service_tier: 'flex',
    messages: [{ role: 'user', content: buildPrompt(text, options.today) }],
    response_format: { type: 'json_schema', json_schema: buildResponseSchema() },
  });

  let last: ExtractionError | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await callOnce(doFetch, options.apiKey, body);
    } catch (error) {
      last = error instanceof ExtractionError ? error : new ExtractionError(String(error), true);
      // A schema-shaped failure will not fix itself on a second identical call, but a
      // truncated or empty response might, so both are retried once.
    }
  }
  throw last ?? new ExtractionError('Extraction failed for an unknown reason.', true);
}

/**
 * Makes one request and parses the reply.
 *
 * @param doFetch The fetch implementation to use.
 * @param apiKey The OpenAI API key.
 * @param body The pre-serialised request body.
 * @returns The parsed extraction.
 * @throws {ExtractionError} On any transport, status or shape failure.
 */
async function callOnce(doFetch: typeof fetch, apiKey: string, body: string): Promise<Extraction> {
  let response: Response;
  try {
    response = await doFetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
  } catch (error) {
    throw new ExtractionError(`Could not reach the model API: ${String(error)}`, true);
  }

  if (!response.ok) {
    const detail = (await safeText(response)).slice(0, 500);
    /*
     * EVERY HTTP STATUS FAILURE IS TRANSIENT, INCLUDING 4xx.
     *
     * This reads wrong at first -- a 401 will fail identically forever -- so it is worth
     * stating why. `transient: false` does not mean "do not retry"; it means "record a
     * permanent failure against this message", which marks it processed and guarantees it
     * is never parsed again.
     *
     * The status failures all describe the REQUEST CONFIGURATION: the key, the model name,
     * the schema. Every one of those is identical for every message, so none of them can be
     * a property of the message being parsed. A wrong OPENAI_API_KEY previously made the
     * drain mark the entire backlog permanently failed within one run -- every parade state
     * queued that morning silently written off, recoverable only by hand. A verification run
     * against the live database did exactly that before this was changed.
     *
     * Leaving them unprocessed costs a cheap failing request per tick until an operator
     * fixes the configuration, and the drain's `failed` count is what makes that visible. A
     * failure here does not block the queue: `parseDue` continues to the next message.
     *
     * Permanent failure is reserved for what a retry genuinely cannot change: content the
     * model returned that this code cannot use. Those are checked below.
     */
    throw new ExtractionError(`Model API returned HTTP ${response.status}: ${detail}`, true);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = payload.choices?.[0];
  if (!choice?.message?.content) {
    throw new ExtractionError('Model API returned no content.', true);
  }
  if (choice.finish_reason === 'length') {
    throw new ExtractionError('Model response was truncated before the JSON ended.', true);
  }

  let parsed: Extraction;
  try {
    parsed = JSON.parse(choice.message.content) as Extraction;
  } catch {
    throw new ExtractionError('Model returned content that is not valid JSON.', false);
  }

  // Structured Outputs guarantees these, but a schema change or a future model that
  // silently drops strict mode would otherwise surface as a confusing TypeError deep in
  // row building.
  if (!Array.isArray(parsed.units) || !Array.isArray(parsed.command_team) || !Array.isArray(parsed.personnel)) {
    throw new ExtractionError('Model response is missing one of units, command_team or personnel.', false);
  }
  return parsed;
}

/**
 * Reads a response body as text without letting a decode failure mask the real error.
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
