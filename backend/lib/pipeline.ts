/**
 * The single parade-state write path: store and parse a message, edit or delete one. The rule-based
 * parser runs first; a message it doubts goes to the model, or is stored with reasons for a person.
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
import { paradeResponseId } from '../../shared/domain.ts';
import { cleanText } from '../../shared/identity.ts';
import { needsReviewError, outcomeOf, type MessageSummary } from '../../shared/paradeMessage.ts';
import { parseParadeState } from './parser/deterministic.ts';
import type { Extraction } from './parser/extraction.ts';
import type { OpenAiParser } from './parser/llm.ts';
import { buildRows, validate } from './parser/rows.ts';

/** Recorded on `parade_submissions.model` when the rule-based parser read the message. */
const PARSER_NAME = 'deterministic';

/** The model fallback as the pipeline uses it; tests pass a fake. */
export type ModelParser = Pick<OpenAiParser, 'model' | 'parse'>;

// neon-http's Drizzle handle; typed loosely so tests can pass a fake.
type Db = any;

/** What happened to a message handed to `recordMessage`. */
type RecordOutcome =
  | { status: 'stored'; id: number }
  | { status: 'duplicate'; id: number }
  | { status: 'already_processed'; id: number; paradeResponseId: string | null; error: string | null };

/**
 * Which parser last read a message (`deterministic` or the model id) and how long parsing
 * took, in milliseconds. Stored on `raw_messages` for every parse, successful or not.
 */
export type Timing = { parser: string; parseMs: number };

/** A parse outcome and the parser that settled it, before it is timed. */
type Untimed = (
  | { status: 'parsed'; extraction: Extraction; paradeResponseId: string }
  | { status: 'rejected'; reason: string }
  | { status: 'needs_review'; problems: string[] }
  | { status: 'invalid'; reason: string }
) & { parser: string };

/** How one message's text parsed, before anything is written. */
export type Parsed = Untimed & Timing;

/** What became of a message handed to `ingestMessage` or `editMessage`. */
export type IngestOutcome =
  | ({
      status: 'parsed';
      id: number;
      paradeResponseId: string;
      counts: { strength: number; personnel: number; roster: number; sectionCounts: number };
    } & Timing)
  | { status: 'already_parsed'; id: number; paradeResponseId: string }
  | ({ id: number } & Exclude<Parsed, { status: 'parsed' }>)
  | { status: 'not_found'; id: number };


/** Stores a relayed message; the `wa_message_id` unique constraint settles a duplicate in one statement. */
async function recordMessage(
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
 * Parses message text without touching the database: the rules first, the model when the rules are unsure and
 * a model is configured. Times the whole parse.
 */
export async function parseBody(body: string, today: string, model: ModelParser | null = null): Promise<Parsed> {
  const started = performance.now();
  const parsed = await parseUntimed(body, today, model);
  return { ...parsed, parseMs: Math.round(performance.now() - started) };
}

/** `parseBody` without the timing. */
async function parseUntimed(body: string, today: string, model: ModelParser | null): Promise<Untimed> {
  const rules = parseParadeState(body, today);
  if (rules.problems.length === 0) return settleExtraction(rules.extraction, PARSER_NAME);
  if (!model) return { status: 'needs_review', problems: rules.problems, parser: PARSER_NAME };
  try {
    return settleExtraction(await model.parse(body, today), model.model);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { status: 'needs_review', problems: [...rules.problems, `Model fallback failed: ${why}`], parser: model.model };
  }
}

/** Validates an extraction and keys it. */
function settleExtraction(extraction: Extraction, parser: string): Untimed {
  const reason = validate(extraction);
  if (reason !== '') {
    return extraction.rejected ? { status: 'rejected', reason, parser } : { status: 'invalid', reason, parser };
  }
  return {
    status: 'parsed',
    extraction,
    paradeResponseId: paradeResponseId(extraction.company!, extraction.date!, extraction.session!),
    parser,
  };
}

/**
 * Stores a message and parses it straight away. One already parsed is left alone, so a resend cannot
 * replace a newer parade state; one that failed is parsed again.
 */
export async function ingestMessage(
  db: Db,
  message: { waMessageId: string; body: string },
  now: Date = new Date(),
  model: ModelParser | null = null,
): Promise<IngestOutcome> {
  const recorded = await recordMessage(db, message);
  if (recorded.status === 'already_processed' && recorded.paradeResponseId) {
    return { status: 'already_parsed', id: recorded.id, paradeResponseId: recorded.paradeResponseId };
  }
  return settle(db, recorded.id, await parseBody(cleanText(message.body), isoDay(now), model));
}

/**
 * Replaces a stored message's text and everything derived from it. The new text is parsed first, and
 * one that does not parse changes nothing.
 */
export async function editMessage(
  db: Db,
  id: number,
  body: string,
  model: ModelParser | null = null,
): Promise<IngestOutcome> {
  const [row] = await db
    .select({ receivedAt: rawMessages.receivedAt })
    .from(rawMessages)
    .where(eq(rawMessages.id, id));
  if (!row) return { status: 'not_found', id };

  const text = cleanText(body);
  // Years resolve against the original receipt date, so an edit reads dates as the first parse did.
  const parsed = await parseBody(text, isoDay(new Date(row.receivedAt)), model);
  if (parsed.status !== 'parsed') return withId(id, parsed);
  return write(db, id, parsed, text);
}

/** Deletes a stored message and the submission parsed from it. */
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

/** Lists every stored message, newest first, without its text or its reasons (they can quote a personnel line). */
export async function listMessages(db: Db): Promise<MessageSummary[]> {
  const rows = await db
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
  return rows.map(({ error, ...row }: { error: string | null } & Omit<MessageSummary, 'outcome' | 'problems'>) => ({
    ...row,
    ...outcomeOf(error),
  }));
}

/** Reads one stored message's text and why it produced no rows, for editing. */
export async function getMessage(
  db: Db,
  id: number,
): Promise<{ id: number; body: string; error: string | null } | null> {
  const [row] = await db
    .select({ id: rawMessages.id, body: rawMessages.body, error: rawMessages.error })
    .from(rawMessages)
    .where(eq(rawMessages.id, id));
  return row ?? null;
}

/** Writes a parse result against a stored message: rows when it parsed, the reason when not. */
async function settle(db: Db, id: number, parsed: Parsed): Promise<IngestOutcome> {
  if (parsed.status === 'parsed') return write(db, id, parsed);
  await markFailed(db, id, failureText(parsed), { parser: parsed.parser, parseMs: parsed.parseMs });
  return withId(id, parsed);
}

/** Builds a parsed message's rows and writes them. */
async function write(
  db: Db,
  id: number,
  parsed: Extract<Parsed, { status: 'parsed' }>,
  body?: string,
): Promise<IngestOutcome> {
  const key = parsed.paradeResponseId;
  const rows = buildRows(parsed.extraction, { paradeResponseId: key, sourceMessageId: id, model: parsed.parser });
  const timing = { parser: parsed.parser, parseMs: parsed.parseMs };
  await writeSubmission(db, id, key, rows, timing, body);
  return {
    ...timing,
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
 * Replaces a submission and everything under it in one `db.batch` (neon-http has no transactions, hence the
 * computable key); the first statement removes the submission under a message's old key.
 */
async function writeSubmission(
  db: Db,
  messageId: number,
  key: string,
  rows: ReturnType<typeof buildRows>,
  timing: Timing,
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
      .set({
        paradeResponseId: key,
        error: null,
        processedAt: sql`now()`,
        ...timing,
        ...(body === undefined ? {} : { body }),
      })
      .where(eq(rawMessages.id, messageId)),
  );

  await db.batch(statements as never);
}

/** Records why a message produced no rows, so it is not retried and the list can show why. */
async function markFailed(db: Db, messageId: number, reason: string, timing: Timing): Promise<void> {
  await db
    .update(rawMessages)
    .set({ error: reason.slice(0, 2000), processedAt: sql`now()`, ...timing })
    .where(eq(rawMessages.id, messageId));
}

/** The `raw_messages.error` text for a parse that produced no rows. */
function failureText(parsed: Exclude<Parsed, { status: 'parsed' }>): string {
  return parsed.status === 'needs_review' ? needsReviewError(parsed.problems) : parsed.reason;
}

/** Attaches a message id to an unsuccessful parse. */
function withId(id: number, parsed: Exclude<Parsed, { status: 'parsed' }>): IngestOutcome {
  return { id, ...parsed };
}

/** The UTC calendar day of a time, as `yyyy-MM-dd`. */
function isoDay(time: Date): string {
  return time.toISOString().slice(0, 10);
}
