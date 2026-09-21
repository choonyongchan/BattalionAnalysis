/**
 * The one implementation of extract -> validate -> replace.
 *
 * The local WhatsApp runner calls `recordMessage` and `parseDue` in-process (see
 * `docs/superpowers/plans/2026-09-21-local-parade-state-parser.md`), so there is exactly one
 * code path that writes parade-state rows and exactly one place a rule about them can live.
 *
 * Intake and parsing are split because the model is slow. A real message took 74 seconds
 * against the flex tier, and the messiest took 126. So `recordMessage` returns the moment
 * the text is safely stored, and the parse drains afterwards. A slow model then delays a
 * row; it never loses one.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import {
  commandRosterRows,
  paradeSubmissions,
  personnelRows,
  rawMessages,
  sectionCounts,
  strengthRows,
} from '../db/schema.ts';
import { cleanText, paradeResponseId } from './domain.ts';
import { ExtractionError, extract } from './parser/extract.ts';
import { buildRows, validate } from './parser/rows.ts';

/** The database handle, as returned by `drizzle(neon(...))`. */
type Db = any;

/** What happened to a message handed to `recordMessage`. */
export type RecordOutcome =
  | { status: 'stored'; id: number }
  | { status: 'duplicate'; id: number }
  | { status: 'already_processed'; id: number; paradeResponseId: string | null; error: string | null };

/**
 * Stores a relayed message, idempotently.
 *
 * The `wa_message_id` unique constraint does the work that LockService used to: the
 * read-then-append race is settled by the database in one statement rather than by a mutex.
 *
 * A message that exists but has never been parsed is reported as `stored`, not `duplicate`.
 * That is deliberate -- it is how a message stranded by a crashed parse gets picked up again
 * when the bridge resends it.
 *
 * @param db A read-write database handle.
 * @param message The relayed message.
 * @returns What became of it, and the row id either way.
 */
export async function recordMessage(
  db: Db,
  message: { waMessageId: string; body: string; source?: 'whatsapp' | 'manual' },
): Promise<RecordOutcome> {
  const inserted = await db
    .insert(rawMessages)
    .values({
      waMessageId: message.waMessageId,
      body: cleanText(message.body),
      source: message.source ?? 'whatsapp',
    })
    .onConflictDoNothing({ target: rawMessages.waMessageId })
    .returning({ id: rawMessages.id });

  if (inserted.length > 0) return { status: 'stored', id: inserted[0]!.id };

  const [existing] = await db
    .select({
      id: rawMessages.id,
      paradeResponseId: rawMessages.paradeResponseId,
      error: rawMessages.error,
      processedAt: rawMessages.processedAt,
    })
    .from(rawMessages)
    .where(eq(rawMessages.waMessageId, message.waMessageId));

  if (!existing) throw new Error('Insert conflicted but the conflicting row could not be read.');
  if (existing.processedAt) {
    return {
      status: 'already_processed',
      id: existing.id,
      paradeResponseId: existing.paradeResponseId,
      error: existing.error,
    };
  }
  return { status: 'duplicate', id: existing.id };
}

/** What happened to one message during a parse run. */
export interface ParseResult {
  id: number;
  waMessageId: string;
  outcome: 'parsed' | 'rejected' | 'failed';
  paradeResponseId?: string;
  reason?: string;
  counts?: { strength: number; personnel: number; roster: number; sectionCounts: number };
}

/** What `parseDue` needs from its caller. */
export interface ParseOptions {
  apiKey: string;
  model?: string;
  limit?: number;
  fetchImpl?: typeof fetch;
  /** Overridden in tests so `today` is deterministic. */
  now?: () => Date;
  /**
   * Epoch milliseconds after which no further message is started.
   *
   * The caller running under a platform timeout sets this. Stopping early is not a failure:
   * whatever was not reached is still unprocessed, so the next run picks it up.
   */
  deadline?: number;
  /** Overridden in tests. Defaults to `Date.now`. */
  clock?: () => number;
}

/** What a parse run did, and what it left behind. */
export interface ParseRun {
  results: ParseResult[];
  /** Messages that were due but not started, because the deadline or limit was reached. */
  skipped: number;
  /** True when the run stopped on its deadline rather than running out of work. */
  stoppedEarly: boolean;
}

/**
 * Parses messages that have not been processed yet.
 *
 * The per-message try/catch is load-bearing: one unparseable message must not stop the
 * queue, or a single bad parade state blocks every company behind it.
 *
 * @param db A read-write database handle.
 * @param options API key, batch limit and test seams.
 * @returns One result per message attempted.
 */
export async function parseDue(db: Db, options: ParseOptions): Promise<ParseRun> {
  const limit = options.limit ?? 20;
  const clock = options.clock ?? Date.now;

  const [backlog] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(rawMessages)
    .where(isNull(rawMessages.processedAt));

  const due = await db
    .select({ id: rawMessages.id, waMessageId: rawMessages.waMessageId, body: rawMessages.body })
    .from(rawMessages)
    .where(isNull(rawMessages.processedAt))
    .orderBy(rawMessages.id)
    .limit(limit);

  const results: ParseResult[] = [];
  let stoppedEarly = false;

  for (const message of due) {
    /*
     * Checked before starting, never during. A message is either attempted whole or not at
     * all, because its write is one batch: stopping here leaves the row unprocessed and the
     * next run repeats it, whereas stopping mid-parse would mean paying for an extraction
     * whose result is thrown away.
     */
    if (options.deadline !== undefined && clock() >= options.deadline) {
      stoppedEarly = true;
      break;
    }
    try {
      results.push(await parseOne(db, message, options));
    } catch (error) {
      // A transient failure is left unprocessed so the next run retries it. A permanent one
      // is recorded against the message so it stops being retried and stops costing money.
      const transient = error instanceof ExtractionError && error.transient;
      const reason = error instanceof Error ? error.message : String(error);
      if (!transient) await markFailed(db, message.id, reason);
      results.push({ id: message.id, waMessageId: message.waMessageId, outcome: 'failed', reason });
    }
  }

  /*
   * A transient failure stays unprocessed by design, so it is still in the backlog after the
   * run. Counting it as skipped as well would double-count it; subtracting only what was
   * attempted keeps `skipped` meaning "not looked at".
   */
  return {
    results,
    skipped: Math.max(0, (backlog?.n ?? 0) - results.length),
    stoppedEarly,
  };
}

/**
 * Extracts one message and writes its rows.
 *
 * @param db A read-write database handle.
 * @param message The stored message.
 * @param options Parse options.
 * @returns What became of it.
 */
async function parseOne(
  db: Db,
  message: { id: number; waMessageId: string; body: string },
  options: ParseOptions,
): Promise<ParseResult> {
  const now = options.now ? options.now() : new Date();
  const today = now.toISOString().slice(0, 10);
  const model = options.model;

  const extraction = await extract(message.body, {
    apiKey: options.apiKey,
    today,
    model,
    fetchImpl: options.fetchImpl,
  });

  const reason = validate(extraction);
  if (reason !== '') {
    await markFailed(db, message.id, reason);
    return {
      id: message.id,
      waMessageId: message.waMessageId,
      outcome: extraction.rejected ? 'rejected' : 'failed',
      reason,
    };
  }

  const key = paradeResponseId(extraction.company!, extraction.date!, extraction.session!);
  const rows = buildRows(extraction, {
    paradeResponseId: key,
    sourceMessageId: message.id,
    model: model ?? null,
  });

  await writeSubmission(db, message.id, key, rows);

  return {
    id: message.id,
    waMessageId: message.waMessageId,
    outcome: 'parsed',
    paradeResponseId: key,
    counts: {
      strength: rows.strength.length,
      personnel: rows.personnel.length,
      roster: rows.roster.length,
      sectionCounts: rows.sectionCounts.length,
    },
  };
}

/**
 * Replaces a submission and everything under it, atomically.
 *
 * One `db.batch`, because neon-http has no interactive transactions: every statement must
 * be known before the first is sent, and none may depend on an earlier `RETURNING`. That is
 * the whole reason `parade_response_id` is a computable natural key.
 *
 * Deleting the parent is enough to clear the children -- they cascade. Under the old
 * spreadsheet the same operation was three independent scans held together by convention.
 *
 * The first statement is the orphan sweep: if this message previously parsed to a different
 * key (a corrected date, say), that earlier submission is removed too. The spreadsheet could
 * only do this when the edit happened to be a single cell; here it is unconditional.
 *
 * @param db A read-write database handle.
 * @param messageId The raw message being parsed.
 * @param key The submission key.
 * @param rows The rows to write.
 */
async function writeSubmission(
  db: Db,
  messageId: number,
  key: string,
  rows: ReturnType<typeof buildRows>,
): Promise<void> {
  const statements: unknown[] = [
    db
      .delete(paradeSubmissions)
      .where(
        and(
          ne(paradeSubmissions.paradeResponseId, key),
          eq(
            paradeSubmissions.paradeResponseId,
            sql`(select ${rawMessages.paradeResponseId} from ${rawMessages} where ${rawMessages.id} = ${messageId})`,
          ),
        ),
      ),
    db.delete(paradeSubmissions).where(eq(paradeSubmissions.paradeResponseId, key)),
    db.insert(paradeSubmissions).values(rows.submission as never),
  ];

  // Drizzle rejects an insert with no values, and a company can legitimately file a parade
  // state with an empty section, so each child insert is conditional.
  if (rows.strength.length) statements.push(db.insert(strengthRows).values(rows.strength as never));
  if (rows.personnel.length) statements.push(db.insert(personnelRows).values(rows.personnel as never));
  if (rows.roster.length) statements.push(db.insert(commandRosterRows).values(rows.roster as never));
  if (rows.sectionCounts.length) {
    statements.push(db.insert(sectionCounts).values(rows.sectionCounts as never));
  }

  statements.push(
    db
      .update(rawMessages)
      .set({ paradeResponseId: key, error: null, processedAt: sql`now()` })
      .where(eq(rawMessages.id, messageId)),
  );

  await db.batch(statements as never);
}

/**
 * Records a permanent failure against a message so it is not retried.
 *
 * @param db A read-write database handle.
 * @param messageId The message that failed.
 * @param reason The reason, written verbatim for whoever investigates.
 */
async function markFailed(db: Db, messageId: number, reason: string): Promise<void> {
  await db
    .update(rawMessages)
    .set({ error: reason.slice(0, 2000), processedAt: sql`now()` })
    .where(eq(rawMessages.id, messageId));
}
