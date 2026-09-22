/**
 * The single parade-state write path. `ingestMessage` stores a message and parses it in the
 * same call; `editMessage` and `deleteMessage` are how the dashboard corrects one afterwards.
 *
 * Parsing is `lib/parser/deterministic.ts` alone: about a millisecond, no model, so it fits
 * inside a Vercel function. A message it is unsure of is stored with the reasons and left for
 * a person to correct, never guessed at.
 */
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  commandRosterRows,
  paradeSubmissions,
  personnelRows,
  rawMessages,
  sectionCounts,
  strengthRows,
} from '../db/schema.ts';
import { cleanText, paradeResponseId } from './domain.ts';
import { parseParadeState } from './parser/deterministic.ts';
import type { Extraction } from './parser/extraction.ts';
import { buildRows, validate } from './parser/rows.ts';

/** Recorded on `parade_submissions.model`, which predates the parser being rule-based. */
const PARSER_NAME = 'deterministic';

/** Prefixed to `raw_messages.error` when the parser was unsure, so the list can say so. */
const NEEDS_REVIEW = 'Needs review: ';

// neon-http's Drizzle handle; typed loosely so tests can pass a fake.
type Db = any;

/** What happened to a message handed to `recordMessage`. */
export type RecordOutcome =
  | { status: 'stored'; id: number }
  | { status: 'duplicate'; id: number }
  | { status: 'already_processed'; id: number; paradeResponseId: string | null; error: string | null };

/** How one message's text parsed, before anything is written. */
export type Parsed =
  | { status: 'parsed'; extraction: Extraction; paradeResponseId: string }
  | { status: 'rejected'; reason: string }
  | { status: 'needs_review'; problems: string[] }
  | { status: 'invalid'; reason: string };

/** What became of a message handed to `ingestMessage` or `editMessage`. */
export type IngestOutcome =
  | {
      status: 'parsed';
      id: number;
      paradeResponseId: string;
      counts: { strength: number; personnel: number; roster: number; sectionCounts: number };
    }
  | { status: 'already_parsed'; id: number; paradeResponseId: string }
  | { status: 'rejected'; id: number; reason: string }
  | { status: 'needs_review'; id: number; problems: string[] }
  | { status: 'invalid'; id: number; reason: string }
  | { status: 'not_found'; id: number };

/** One stored message as the dashboard lists it. Carries no body. */
export interface MessageSummary {
  id: number;
  waMessageId: string;
  receivedAt: Date;
  processedAt: Date | null;
  paradeResponseId: string | null;
  error: string | null;
}

/**
 * Stores a relayed message, idempotently.
 *
 * The `wa_message_id` unique constraint settles a duplicate delivery in one statement rather
 * than by a lock. `stored` reports only whether this call inserted the row.
 *
 * @param db A read-write database handle.
 * @param message The relayed message.
 * @returns What became of it, and the row id either way.
 */
export async function recordMessage(
  db: Db,
  message: { waMessageId: string; body: string },
): Promise<RecordOutcome> {
  const inserted = await db
    .insert(rawMessages)
    .values({
      waMessageId: message.waMessageId,
      body: cleanText(message.body),
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

/**
 * Parses message text without touching the database.
 *
 * @param body The message text.
 * @param today The receipt date, `yyyy-MM-dd`, that two-digit years resolve against.
 * @returns The extraction and its key, or why there is none.
 */
export function parseBody(body: string, today: string): Parsed {
  const { extraction, problems } = parseParadeState(body, today);
  if (problems.length > 0) return { status: 'needs_review', problems };

  const reason = validate(extraction);
  if (reason !== '') {
    return extraction.rejected ? { status: 'rejected', reason } : { status: 'invalid', reason };
  }
  return {
    status: 'parsed',
    extraction,
    paradeResponseId: paradeResponseId(extraction.company!, extraction.date!, extraction.session!),
  };
}

/**
 * Stores a message and parses it straight away.
 *
 * A message already parsed is left alone, so a resend cannot replace a newer parade state
 * with an older one. A message stored earlier but not parsed (a crash, or a parser that has
 * since learnt a new rule) is parsed again, which is free.
 *
 * @param db A read-write database handle.
 * @param message The message and its idempotency key.
 * @param now The current time; injected in tests.
 * @returns What became of it.
 */
export async function ingestMessage(
  db: Db,
  message: { waMessageId: string; body: string },
  now: Date = new Date(),
): Promise<IngestOutcome> {
  const recorded = await recordMessage(db, message);
  if (recorded.status === 'already_processed' && recorded.paradeResponseId) {
    return { status: 'already_parsed', id: recorded.id, paradeResponseId: recorded.paradeResponseId };
  }
  return settle(db, recorded.id, parseBody(cleanText(message.body), isoDay(now)));
}

/**
 * Replaces a stored message's text and everything derived from it.
 *
 * The new text is parsed before anything is written, and a text that does not parse
 * changes nothing: the old rows stay until a correct text replaces them. When the new text
 * names a different company, date or session, the submission under the old key is removed.
 *
 * @param db A read-write database handle.
 * @param id The `raw_messages` id.
 * @param body The corrected text.
 * @returns What became of it.
 */
export async function editMessage(db: Db, id: number, body: string): Promise<IngestOutcome> {
  const [row] = await db
    .select({ receivedAt: rawMessages.receivedAt })
    .from(rawMessages)
    .where(eq(rawMessages.id, id));
  if (!row) return { status: 'not_found', id };

  const text = cleanText(body);
  // Years resolve against the original receipt date, so an edit reads dates as the first parse did.
  const parsed = parseBody(text, isoDay(new Date(row.receivedAt)));
  if (parsed.status !== 'parsed') return withId(id, parsed);
  return write(db, id, parsed, text);
}

/**
 * Deletes a stored message and the submission parsed from it.
 *
 * @param db A read-write database handle.
 * @param id The `raw_messages` id.
 * @returns False when there was no such message.
 */
export async function deleteMessage(db: Db, id: number): Promise<boolean> {
  const [row] = await db
    .select({ paradeResponseId: rawMessages.paradeResponseId })
    .from(rawMessages)
    .where(eq(rawMessages.id, id));
  if (!row) return false;

  const statements: unknown[] = [];
  // The child rows cascade from the submission; the message's own link is only a text copy.
  if (row.paradeResponseId) {
    statements.push(db.delete(paradeSubmissions).where(eq(paradeSubmissions.paradeResponseId, row.paradeResponseId)));
  }
  statements.push(db.delete(rawMessages).where(eq(rawMessages.id, id)));
  await db.batch(statements as never);
  return true;
}

/**
 * Lists every stored message, newest first, without its text.
 *
 * @param db A database handle.
 * @returns One summary per message.
 */
export async function listMessages(db: Db): Promise<MessageSummary[]> {
  return db
    .select({
      id: rawMessages.id,
      waMessageId: rawMessages.waMessageId,
      receivedAt: rawMessages.receivedAt,
      processedAt: rawMessages.processedAt,
      paradeResponseId: rawMessages.paradeResponseId,
      error: rawMessages.error,
    })
    .from(rawMessages)
    .orderBy(desc(rawMessages.id));
}

/**
 * Reads one stored message's text, for editing.
 *
 * @param db A database handle.
 * @param id The `raw_messages` id.
 * @returns The id and text, or null when there is no such message.
 */
export async function getMessage(db: Db, id: number): Promise<{ id: number; body: string } | null> {
  const [row] = await db
    .select({ id: rawMessages.id, body: rawMessages.body })
    .from(rawMessages)
    .where(eq(rawMessages.id, id));
  return row ?? null;
}

/**
 * Writes a parse result against a stored message: rows when it parsed, the reason when not.
 *
 * @param db A read-write database handle.
 * @param id The `raw_messages` id.
 * @param parsed How its text parsed.
 * @returns What became of it.
 */
async function settle(db: Db, id: number, parsed: Parsed): Promise<IngestOutcome> {
  if (parsed.status === 'parsed') return write(db, id, parsed);
  await markFailed(db, id, failureText(parsed));
  return withId(id, parsed);
}

/**
 * Builds a parsed message's rows and writes them.
 *
 * @param db A read-write database handle.
 * @param id The `raw_messages` id.
 * @param parsed A successful parse.
 * @param body Replacement text for the message, when editing.
 * @returns The `parsed` outcome with row counts.
 */
async function write(
  db: Db,
  id: number,
  parsed: Extract<Parsed, { status: 'parsed' }>,
  body?: string,
): Promise<IngestOutcome> {
  const key = parsed.paradeResponseId;
  const rows = buildRows(parsed.extraction, { paradeResponseId: key, sourceMessageId: id, model: PARSER_NAME });
  await writeSubmission(db, id, key, rows, body);
  return {
    status: 'parsed',
    id,
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
 * The first statement is the orphan sweep: if this message previously parsed to a different
 * key (a corrected date, say), that earlier submission is removed too. Deleting a parent is
 * enough to clear its children -- they cascade.
 *
 * @param db A read-write database handle.
 * @param messageId The raw message being parsed.
 * @param key The submission key.
 * @param rows The rows to write.
 * @param body Replacement text for the message, when editing; the text is left alone otherwise.
 */
async function writeSubmission(
  db: Db,
  messageId: number,
  key: string,
  rows: ReturnType<typeof buildRows>,
  body?: string,
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
      .set({ paradeResponseId: key, error: null, processedAt: sql`now()`, ...(body === undefined ? {} : { body }) })
      .where(eq(rawMessages.id, messageId)),
  );

  await db.batch(statements as never);
}

/**
 * Records why a message produced no rows, so it is not retried and the list can show why.
 *
 * @param db A read-write database handle.
 * @param messageId The message.
 * @param reason The reason, written verbatim for whoever corrects it.
 */
async function markFailed(db: Db, messageId: number, reason: string): Promise<void> {
  await db
    .update(rawMessages)
    .set({ error: reason.slice(0, 2000), processedAt: sql`now()` })
    .where(eq(rawMessages.id, messageId));
}

/**
 * The `raw_messages.error` text for a parse that produced no rows.
 *
 * @param parsed An unsuccessful parse.
 * @returns The text.
 */
function failureText(parsed: Exclude<Parsed, { status: 'parsed' }>): string {
  return parsed.status === 'needs_review' ? NEEDS_REVIEW + parsed.problems.join(' | ') : parsed.reason;
}

/**
 * Attaches a message id to an unsuccessful parse.
 *
 * @param id The `raw_messages` id.
 * @param parsed An unsuccessful parse.
 * @returns The outcome.
 */
function withId(id: number, parsed: Exclude<Parsed, { status: 'parsed' }>): IngestOutcome {
  return { id, ...parsed };
}

/**
 * The UTC calendar day of a time, as `yyyy-MM-dd`.
 *
 * @param time The time.
 * @returns The day.
 */
function isoDay(time: Date): string {
  return time.toISOString().slice(0, 10);
}
