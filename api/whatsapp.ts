/**
 * Parade-state intake. Stores the message and returns; never parses.
 *
 * THIS ROUTE MUST NOT CALL THE MODEL. A real parade state takes the extractor 74 seconds and
 * the messiest one in the reference corpus took 126 -- past every Vercel Hobby timeout and
 * most of the Pro one. A route that parsed inline would time out, and a timed-out intake is
 * the worst outcome available: the bridge cannot tell a lost message from a slow one, so it
 * either retries and duplicates or gives up and loses. Storing the text takes one `INSERT`,
 * so the answer is immediate and the same every time.
 *
 * Hence 202 rather than 201 or 200. The message is accepted and durable; the rows it will
 * become do not exist yet. `api/parse-due.ts` produces them on a schedule.
 *
 * The bridge decides what is a parade state; this route decides nothing about content. That
 * boundary is deliberate -- the bridge already has the group id, the sender and the first-
 * parade gate, and duplicating its judgement here would mean two places to fix a rule.
 */
import { getDb } from '../db/index.ts';
import { json, methodNotAllowed, readJson, requireBearer, serverError } from '../lib/http.ts';
import { recordMessage, type RecordOutcome } from '../lib/pipeline.ts';

/** What the bridge POSTs. Field names match the bridge's existing vocabulary. */
interface IntakePayload {
  messageId?: unknown;
  text?: unknown;
  source?: unknown;
}

/** What `handle` needs, injected so tests need no database. */
export interface Deps {
  db: unknown;
  token: string | undefined;
  /** Injected in tests. Defaults to the real `recordMessage`. */
  record?: typeof recordMessage;
}

/**
 * The largest message body accepted, in characters.
 *
 * The four real parade states run 1.5-4 KB. 64 KB is far above any of them and far below
 * anything that could fill a column or a model context by accident. A cap belongs here
 * rather than in the database because the point is to refuse the request, not to truncate
 * the row.
 */
const MAX_BODY_CHARS = 64_000;

/**
 * Validates and stores one relayed message.
 *
 * @param request The incoming request.
 * @param deps The database handle and the expected ingest token.
 * @returns 202 when stored or already known, 4xx when the request is wrong.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);

  const denied = requireBearer(request, deps.token, 'WHATSAPP_INGEST_TOKEN');
  if (denied) return denied;

  const parsed = await readJson<IntakePayload>(request);
  if (!parsed.ok) return parsed.response;

  const messageId = typeof parsed.body.messageId === 'string' ? parsed.body.messageId.trim() : '';
  const text = typeof parsed.body.text === 'string' ? parsed.body.text : '';
  const source = parsed.body.source === 'manual' ? 'manual' : 'whatsapp';

  if (messageId === '') return json(400, { error: 'messageId is required.' });
  if (text.trim() === '') return json(400, { error: 'text is required.' });
  if (text.length > MAX_BODY_CHARS) {
    return json(413, { error: `text exceeds ${MAX_BODY_CHARS} characters.` });
  }

  let outcome: RecordOutcome;
  try {
    outcome = await (deps.record ?? recordMessage)(deps.db, {
      waMessageId: messageId,
      body: text,
      source,
    });
  } catch (error) {
    return serverError(error, 'api/whatsapp');
  }

  /*
   * Every outcome is a 202, including the duplicate. A resend is a success from the bridge's
   * point of view -- the message is stored -- and answering 409 would make a correct,
   * expected retry look like an error in its logs. The distinction is in the body for anyone
   * who wants it.
   *
   * `already_processed` carries the parse result, so a bridge resending after a restart
   * learns immediately that the message was rejected, instead of waiting for a cron run that
   * will never look at it again.
   */
  const body: Record<string, unknown> = { status: outcome.status, id: outcome.id };
  if (outcome.status === 'already_processed') {
    body.paradeResponseId = outcome.paradeResponseId;
    body.error = outcome.error;
  }
  return json(202, body);
}

/**
 * The Vercel entry point.
 *
 * @param request The incoming request.
 * @returns The response.
 */
export default function (request: Request): Promise<Response> {
  return handle(request, { db: getDb(), token: process.env.WHATSAPP_INGEST_TOKEN });
}
