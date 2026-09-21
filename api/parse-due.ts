/**
 * The parse drain. Runs on a schedule and turns stored messages into rows.
 *
 * This is the half of intake that is allowed to be slow. `api/whatsapp.ts` answers in one
 * `INSERT`; everything expensive happens here, where nothing is waiting on the other end of
 * a socket and a slow run costs latency rather than a lost message.
 *
 * THE BUDGET IS THE DESIGN. The extractor takes 74-126 seconds per message, so a function
 * capped at `maxDuration` can finish two or three, not a backlog. Rather than guess a safe
 * `limit`, the run is given a wall-clock deadline and stops at the last message it can
 * start. Whatever it did not reach is still unprocessed, so the next tick takes it. The
 * queue drains at a few messages per tick instead of one run dying at the platform timeout
 * with an extraction paid for and discarded.
 *
 * Safe to run concurrently with itself only in the sense that nothing corrupts: two
 * overlapping runs would both select the same due rows and pay twice for the same
 * extraction, with the second write replacing the first. The schedule is spaced so this does
 * not arise; `SELECT ... FOR UPDATE SKIP LOCKED` is the fix if it ever does, and it needs a
 * transaction, which neon-http does not have.
 */
import { getDb } from '../db/index.ts';
import { json, methodNotAllowed, requireBearer, serverError } from '../lib/http.ts';
import { parseDue, type ParseRun } from '../lib/pipeline.ts';

/**
 * Seconds Vercel allows this function to run.
 *
 * Read by Vercel from the export. 300 is the Pro ceiling for the Node runtime; on Hobby this
 * is silently capped at 60, which still completes a message but rarely two. The deadline
 * below is derived from it either way, so an incorrect assumption costs throughput rather
 * than correctness.
 */
export const maxDuration = 300;

/**
 * Wall-clock milliseconds held back for the work after the last extraction.
 *
 * The final message's database write, the response, and the margin by which a 126-second
 * extraction can exceed its observed worst case. Being killed mid-write is not a corruption
 * risk -- the write is one batch -- but it does waste an extraction that was already paid
 * for, so the reserve is generous.
 */
const RESERVE_MS = 45_000;

/** How many messages one run will start, whatever the budget allows. */
const MAX_PER_RUN = 5;

/** What `handle` needs, injected so tests need neither a database nor a model. */
export interface Deps {
  db: unknown;
  secret: string | undefined;
  apiKey: string | undefined;
  model?: string;
  /** Injected in tests. Defaults to the real `parseDue`. */
  parse?: typeof parseDue;
  /** Injected in tests. Defaults to `Date.now`. */
  clock?: () => number;
}

/**
 * Drains due messages within a time budget.
 *
 * @param request The incoming request. Vercel Cron issues GET; POST is accepted so the
 *   drain can be kicked by hand without pretending to be the scheduler.
 * @param deps Database handle, secrets and test seams.
 * @returns A summary of what the run did and what it left.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return methodNotAllowed(['GET', 'POST']);
  }

  const denied = requireBearer(request, deps.secret, 'CRON_SECRET');
  if (denied) return denied;

  if (!deps.apiKey) return json(503, { error: 'OPENAI_API_KEY is not configured.' });

  const clock = deps.clock ?? Date.now;
  const started = clock();

  let run: ParseRun;
  try {
    run = await (deps.parse ?? parseDue)(deps.db, {
      apiKey: deps.apiKey,
      model: deps.model,
      limit: MAX_PER_RUN,
      deadline: started + Math.max(0, maxDuration * 1000 - RESERVE_MS),
      clock,
    });
  } catch (error) {
    return serverError(error, 'api/parse-due');
  }

  /*
   * Counted by outcome rather than listed. A parade state's `wa_message_id` and its rejection
   * reason are both operational detail about real messages, and this response goes to a
   * scheduler's log, which is not somewhere to put them. `failed` and `rejected` are the
   * numbers worth alerting on, and the messages themselves carry their own reason in the
   * database for whoever investigates.
   */
  const tally = { parsed: 0, rejected: 0, failed: 0 };
  for (const result of run.results) tally[result.outcome] += 1;

  return json(200, {
    ...tally,
    skipped: run.skipped,
    stoppedEarly: run.stoppedEarly,
    elapsedMs: clock() - started,
  });
}

/**
 * The Vercel entry point.
 *
 * @param request The incoming request.
 * @returns The response.
 */
export default function (request: Request): Promise<Response> {
  return handle(request, {
    db: getDb(),
    secret: process.env.CRON_SECRET,
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL,
  });
}
