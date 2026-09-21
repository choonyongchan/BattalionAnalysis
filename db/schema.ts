/**
 * The single source of truth for the database layout.
 *
 * Migrations and row types are both generated from this file, never the reverse. The
 * vocabulary below (companies, sessions, categories, roles) is stated here once and
 * nowhere else: `lib/parser/schema.ts` builds the OpenAI strict-JSON enums from
 * `.enumValues`, so the parser cannot drift from the database the way the old
 * ParserSchema.js / domain.js / tabs.js triangle could.
 *
 * NRIC IS DELIBERATELY ABSENT. FormSG returns `SingPass Validated NRIC` and `Masked
 * NRIC`; api/formsg.ts discards both before inserting. Nothing reads an NRIC, so nothing
 * stores one. Identity is `name_key` -- a normalised name -- which was verified 1:1 with
 * NRIC across all 803 people in the 2,376-response export. Do not add these columns "for
 * completeness".
 *
 * Shape: a parent submission with cascading children, rather than the spreadsheet's flat
 * repetition of date/session/company on every row. The spreadsheet repeated them because a
 * tab has no parent-child relation, not because anything wanted it. Here `ON DELETE
 * CASCADE` makes "replace everything for this company-day" an invariant the database
 * enforces instead of three coordinated scans.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ------------------------------------------------------------------ enums */

/**
 * The five rifle companies. Scorpion was dropped: it appears in no parade state, in no
 * FormSG submission across 2,376 responses, and in no section of the format spec, which
 * says "one format for all five companies".
 *
 * FormSG's `Unit & Coy` pick-list folds Bn HQ into Hercules (`40 SAR / Hercules & Bn HQ`),
 * so that value maps here to `Hercules`.
 */
export const companyEnum = pgEnum('company', [
  'Archer',
  'Braves',
  'Cougar',
  'Stallion',
  'Hercules',
]);

/**
 * First or last parade state.
 *
 * Only FPS is ingested. LPS remains in the enum on purpose: a company that files a LAST
 * PARADE STATE should be *recorded as rejected* with the session it claimed, not silently
 * mis-filed as a first parade. Cougar filed one in the reference corpus.
 */
export const sessionEnum = pgEnum('session', ['FPS', 'LPS']);

/**
 * What kind of block a strength row describes.
 *
 * `Company` is the roll-up total at the top of the message; the rest are the blocks
 * beneath it. Summing across mixed unit types double-counts, which is what this column
 * exists to prevent. `SUBUNIT` covers the named non-numeric blocks -- SIG, OPR+ASA, MED,
 * PNR, SCR, MTR -- that Stallion and Hercules file instead of numbered platoons.
 */
export const unitTypeEnum = pgEnum('unit_type', ['Company', 'HQ', 'PLATOON', 'SUBUNIT']);

/**
 * The six section headers, which the format spec fixes: "The six section names never
 * change: ATT C, STATUS, REPORT SICK, MA, OFF/LEAVE, OTHERS. Do not rename, merge or
 * split them."
 */
export const reasonCategoryEnum = pgEnum('reason_category', [
  'Att C',
  'Status',
  'Report Sick',
  'MA',
  'Off/Leave',
  'Others',
]);

/**
 * The kind of command appointment, separated from which sub-unit it commands.
 *
 * The old COMMAND_ROLES enum listed CDO/CDS/COS/PDS1..PDS4 as seven flat values and could
 * not express `PDS 7`, `PDS SIG`, `PDS OPR+ASA`, `PDS MED`, `PDS PNR`, `PDS SCR` or
 * `PDS MTR` -- all of which occur. Because it was a strict JSON-Schema enum, the model
 * could not emit them at all, so the command roster silently voided for four of five
 * companies. Splitting the kind from the label fixes that without an open enum.
 */
export const roleKindEnum = pgEnum('role_kind', ['CDO', 'CDS', 'COS', 'PDS']);

/**
 * Report-sick sub-type, shared by both data streams.
 *
 * Parade states write the token directly (`(RSO)`); FormSG's pick-list maps onto the same
 * vocabulary (`Report Sick In-Camp (RSI)` -> RSI, `Medical Review` -> MR). Stating it once
 * is what lets the two sources be compared at all. `PENDING` occurs only in parade states,
 * where an outcome is not yet known.
 */
export const reportSickTypeEnum = pgEnum('report_sick_type', [
  'RSI',
  'RSO',
  'MR',
  'FFI',
  'PENDING',
]);

/**
 * What the doctor gave, from the FormSG section added on 2026-09-16.
 *
 * This is the only MC-versus-status outcome data in the system; parade states record the
 * consequence but never the decision.
 */
export const outcomeEnum = pgEnum('outcome', ['MC', 'Status', 'Both', 'None']);

/** How a raw parade state arrived. `manual` marks a hand-deposited one. */
export const intakeSourceEnum = pgEnum('intake_source', ['whatsapp', 'manual']);

/* --------------------------------------------------------- raw intake */

/**
 * One row per relayed WhatsApp message. Holds the parade-state free text.
 *
 * THIS IS THE PRIVACY BOUNDARY. `body` is a duty commander's raw message: NRICs, full
 * names and diagnoses in one blob. The dashboard's read role has no `SELECT` on this
 * column, so a read route that asks for it gets a database error rather than leaking it.
 * Under the spreadsheet this was a column projection in application code that any careless
 * edit could undo.
 *
 * `wa_message_id UNIQUE` is what replaces LockService: the read-then-append race the lock
 * existed to close is now `on conflict (wa_message_id) do nothing`, settled by the database
 * in one statement.
 *
 * State, replacing the spreadsheet's sentinel strings (both deleted -- they existed only
 * because a cell cannot be NULL):
 *   processed_at NULL                     -> due (never run, or a run that died)
 *   error NOT NULL                        -> failed; the reason is in `error`
 *   parade_response_id NOT NULL           -> parsed
 */
export const rawMessages = pgTable(
  'raw_messages',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    waMessageId: text('wa_message_id').notNull().unique(),
    source: intakeSourceEnum('source').notNull().default('whatsapp'),
    /** The parade-state free text. NEVER selected by api/dashboard.ts. */
    body: text('body').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    /**
     * What this message parsed to. Deliberately NOT a foreign key: it is history, and must
     * survive its submission being replaced by a later message. With `received_at`, it is
     * also the only column here the dashboard is allowed to read.
     */
    paradeResponseId: text('parade_response_id'),
    error: text('error'),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
  },
  (t) => [
    index('raw_messages_due_idx').on(t.id).where(sql`${t.processedAt} is null`),
    index('raw_messages_parade_response_id_idx').on(t.paradeResponseId),
  ],
);

/* ------------------------------------------------ the parade submission */

/**
 * One row per (company, date, session).
 *
 * `parade_response_id` is the `${company}_${isoDate}_${session}` key the spreadsheet used,
 * kept as a text natural primary key so the whole delete-and-replace cycle fits in one
 * `db.batch([...])`. That is forced by the driver: neon-http has no interactive
 * transactions, so no statement may depend on an earlier statement's `RETURNING`. A text
 * key is computable before any database contact; a surrogate id is not.
 *
 * `parade_time` is new. The spreadsheet recorded no parade time anywhere, which meant
 * filing punctuality -- HQ's stated reason for standardising the format -- could not be
 * measured, and parade times range from 0700 to 0930 across companies, so "present at first
 * parade" was not a comparable quantity between them.
 */
export const paradeSubmissions = pgTable(
  'parade_submissions',
  {
    paradeResponseId: text('parade_response_id').primaryKey(),
    company: companyEnum('company').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    session: sessionEnum('session').notNull(),
    /** From the `TIME: HHMM` header. Nullable: a company may omit it. */
    paradeTime: time('parade_time'),
    /** Nullable so purging a raw message does not take the parsed data with it. */
    sourceMessageId: integer('source_message_id').references(() => rawMessages.id, {
      onDelete: 'set null',
    }),
    /** Which model produced these rows, so an odd row is traceable rather than guessable. */
    model: text('model'),
    extractedAt: timestamp('extracted_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('parade_submissions_natural_key').on(t.company, t.date, t.session),
    index('parade_submissions_date_idx').on(t.date),
  ],
);

/* ----------------------------------------------------------- child rows */

/**
 * One row per unit block, including the `Company` roll-up at the top of the message.
 *
 * Rank tiers are nullable because they are genuinely absent in real messages -- Stallion
 * files `OFFICER: 0` rather than `0/0` for an empty tier, and older formats omitted tiers
 * entirely.
 */
export const strengthRows = pgTable(
  'strength_rows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    paradeResponseId: text('parade_response_id')
      .notNull()
      .references(() => paradeSubmissions.paradeResponseId, { onDelete: 'cascade' }),
    /** Verbatim block label: `COY HQ`, `PL 7`, `SIG`, `OPR+ASA`, `MED`, `PNR`, `SCR`, `MTR`. */
    unitLabel: text('unit_label').notNull(),
    unitType: unitTypeEnum('unit_type').notNull(),
    totalStrength: integer('total_strength').notNull(),
    totalPresent: integer('total_present').notNull(),
    officerStrength: integer('officer_strength'),
    officerPresent: integer('officer_present'),
    wospecStrength: integer('wospec_strength'),
    wospecPresent: integer('wospec_present'),
    enlisteeStrength: integer('enlistee_strength'),
    enlisteePresent: integer('enlistee_present'),
  },
  (t) => [
    index('strength_rows_submission_idx').on(t.paradeResponseId),
    check(
      'strength_rows_non_negative',
      sql`${t.totalStrength} >= 0 and ${t.totalPresent} >= 0`,
    ),
    /*
     * DELIBERATELY ABSENT: check (total_present <= total_strength), and any check that unit
     * blocks sum to the company total. Real messages fail both -- 3 of 15 audited files had
     * strength arithmetic that does not add up, and the format spec's own worked example
     * reproduces the error. A constraint here would reject genuine parade states at the
     * worst possible moment. Arithmetic disagreement is surfaced as a data-quality finding,
     * not an insert-time rejection.
     */
  ],
);

/**
 * One row per entry line, uniform across all six sections.
 *
 * The line grammar this models:
 *   <n>. <4D?> <RANK> <NAME> - <DUTY> (<SUB-REASON>) (<DATES>) [OUT|IN] [@ <LOCATION>]
 *
 * `duty_type` and `sub_reason` are split, which the spreadsheet never did. `3D MC (Fever)`
 * carries two distinct values; folding them into one free-text column is why the old data
 * could count MCs but never answer "how many URTI cases this week". Splitting them is the
 * single biggest gain from the new format.
 *
 * `start_time` likewise gets its own column. The old prompt folded a stated time into the
 * reason text, so `MA (Dermatology) (1610)` and `MA (Dermatology) (0930)` were different
 * strings that never grouped.
 */
export const personnelRows = pgTable(
  'personnel_rows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    paradeResponseId: text('parade_response_id')
      .notNull()
      .references(() => paradeSubmissions.paradeResponseId, { onDelete: 'cascade' }),
    unitLabel: text('unit_label').notNull(),
    /** Position within its section, for tracing a row back to the message. */
    entryIndex: smallint('entry_index'),
    reasonCategory: reasonCategoryEnum('reason_category').notNull(),

    /** Blank on roughly 14% of lines, and absent entirely from some companies. */
    fourD: text('four_d'),
    rank: text('rank'),
    name: text('name').notNull(),
    /**
     * Normalised name, the identity key across both data streams.
     *
     * Not `four_d`: in the FormSG export 204 of 803 people submitted inconsistent 4D
     * strings, 142 distinct 4D values mapped to more than one person, and 50 were `NIL`
     * placeholders. 4D is kept as an attribute, never used as a key.
     */
    nameKey: text('name_key').notNull(),

    /** The duty or authorisation: `MC`, `LD`, `EXCUSE FLEGS`, `MA`, `ANNUAL LEAVE`, `IMT`. */
    dutyType: text('duty_type'),
    /** The condition, appointment or detail in parentheses: `Fever`, `Sleep medicine`. */
    subReason: text('sub_reason'),
    /** Only meaningful under `Report Sick`. */
    reportSickType: reportSickTypeEnum('report_sick_type'),

    /** The day-count the message STATES. Never derived from the date pair. */
    numDays: smallint('num_days'),
    /**
     * Replaces the old `num_days = 999` sentinel, which silently corrupted any SUM or AVG
     * over status rows.
     */
    isPermanent: boolean('is_permanent').notNull().default(false),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    /** Appointment time from `(281026 0930)`. */
    startTime: time('start_time'),

    /** From a trailing `OUT` / `IN`. Null when the line says nothing. */
    inCamp: boolean('in_camp'),
    location: text('location'),
    /** The verbatim source line. Provenance for an LLM-extracted row. */
    sourceLine: text('source_line'),
  },
  (t) => [
    index('personnel_rows_submission_idx').on(t.paradeResponseId),
    index('personnel_rows_name_key_idx').on(t.nameKey),
    index('personnel_rows_four_d_idx').on(t.fourD),
    check(
      'personnel_rows_num_days_non_negative',
      sql`${t.numDays} is null or ${t.numDays} >= 0`,
    ),
  ],
);

/**
 * One row per command appointment in the message header.
 *
 * `is_vacant` exists because the corpus contains `PDS MED: -`, a dash standing for an
 * unfilled appointment. Recording that as vacant is different from not recording it.
 */
export const commandRosterRows = pgTable(
  'command_roster_rows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    paradeResponseId: text('parade_response_id')
      .notNull()
      .references(() => paradeSubmissions.paradeResponseId, { onDelete: 'cascade' }),
    roleKind: roleKindEnum('role_kind').notNull(),
    /** Which sub-unit a PDS commands: `1`, `7`, `SIG`, `PNR`. Null for CDO/CDS/COS. */
    unitLabel: text('unit_label'),
    rank: text('rank'),
    name: text('name'),
    nameKey: text('name_key'),
    isVacant: boolean('is_vacant').notNull().default(false),
  },
  (t) => [index('command_roster_rows_submission_idx').on(t.paradeResponseId)],
);

/**
 * The count a section header states, kept beside what was actually listed.
 *
 * 14 of 391 audited section headers disagreed with the lines beneath them, and Hercules
 * systematically counts authorisations rather than lines. The derived count is a `count(*)`
 * over personnel_rows, so only the stated number needs storing. Keeping both turns "this
 * company miscounts" into something measurable rather than invisible -- which is exactly
 * the compliance question the format rollout is meant to answer.
 */
export const sectionCounts = pgTable(
  'section_counts',
  {
    paradeResponseId: text('parade_response_id')
      .notNull()
      .references(() => paradeSubmissions.paradeResponseId, { onDelete: 'cascade' }),
    unitLabel: text('unit_label').notNull(),
    reasonCategory: reasonCategoryEnum('reason_category').notNull(),
    /** Null when the header carried no number at all, which also occurs. */
    statedCount: smallint('stated_count'),
  },
  (t) => [
    primaryKey({
      name: 'section_counts_pk',
      columns: [t.paradeResponseId, t.unitLabel, t.reasonCategory],
    }),
  ],
);

/* -------------------------------------------------------------- FormSG */

/**
 * The nine symptom options, as a lookup rather than an enum.
 *
 * The question reads as multi-select but behaves as single-select today: zero of 2,376
 * responses contained the `;` separator FormSG uses for checkboxes. A lookup table plus a
 * nullable `symptom_other_text` is exact for that, and absorbs a switch to checkboxes with
 * a junction table rather than a type migration.
 */
export const symptomCategories = pgTable('symptom_categories', {
  id: smallint('id').primaryKey(),
  label: text('label').notNull().unique(),
  displayOrder: smallint('display_order').notNull(),
});

/**
 * One row per report-sick submission, decrypted in api/formsg.ts.
 *
 * `response_id` as the primary key replaces the LockService-guarded column scan: FormSG's
 * submission id was unique across all 2,376 rows, so `on conflict do nothing` is the whole
 * idempotency story.
 *
 * The outcome columns come from a form section added on 2026-09-16. They are sparse in the
 * historical export and 100% filled since, so they are modelled for what they will be.
 */
export const formsgSubmissions = pgTable(
  'formsg_submissions',
  {
    responseId: text('response_id').primaryKey(),
    formId: text('form_id'),
    /**
     * FormSG sends an offset-aware ISO string, stored as a real instant. This is what
     * deletes FormSgTimestamps.js and the whole CSV-paste repair path: the ambiguous
     * `07 May 2026 19:21:00` text a spreadsheet coerced unpredictably never appears.
     */
    submittedAt: timestamp('submitted_at', { withTimezone: true, mode: 'string' }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),

    rank: text('rank'),
    name: text('name'),
    /** Normalised name; the join key to personnel_rows.name_key. */
    nameKey: text('name_key').notNull(),
    fourD: text('four_d'),
    /** `four_d` upper-cased and trimmed, with `NIL` placeholders nulled. Never a key. */
    fourDNormalised: text('four_d_normalised'),
    company: companyEnum('company'),

    reportSickType: reportSickTypeEnum('report_sick_type'),
    /** When the soldier actually reported sick, distinct from when the form was filled. */
    reportSickTime: time('report_sick_time'),
    reason: text('reason'),
    symptomCategoryId: smallint('symptom_category_id').references(() => symptomCategories.id),
    /** The text after `Others: `, on roughly 9% of submissions. */
    symptomOtherText: text('symptom_other_text'),
    /** The attestation. Five `No` answers exist; they are an integrity signal. */
    attestedGenuine: boolean('attested_genuine'),

    outcome: outcomeEnum('outcome'),
    mcDays: smallint('mc_days'),
  },
  (t) => [
    index('formsg_submissions_submitted_at_idx').on(t.submittedAt),
    index('formsg_submissions_name_key_idx').on(t.nameKey),
    check('formsg_mc_days_sane', sql`${t.mcDays} is null or ${t.mcDays} between 0 and 180`),
  ],
);

/**
 * Statuses given at a report-sick visit.
 *
 * Replaces the export's ten flat columns (`Status Given #1..#5` and their day counts), of
 * which eight are entirely empty. A sixth status then needs no schema change.
 */
export const formsgStatuses = pgTable(
  'formsg_statuses',
  {
    responseId: text('response_id')
      .notNull()
      .references(() => formsgSubmissions.responseId, { onDelete: 'cascade' }),
    seq: smallint('seq').notNull(),
    statusLabel: text('status_label').notNull(),
    days: smallint('days'),
  },
  (t) => [primaryKey({ name: 'formsg_statuses_pk', columns: [t.responseId, t.seq] })],
);

/* ------------------------------------------------ operator-owned tables */

/**
 * Was the hand-maintained "Public Holidays" tab, now editable from the Settings page.
 *
 * `name` stays nullable: calendarMarks.js resolves a blank name from its own gazetted map.
 */
export const publicHolidays = pgTable('public_holidays', {
  date: date('date', { mode: 'string' }).primaryKey(),
  name: text('name'),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

/**
 * Was the hand-maintained "Rotations" tab. A null `end_date` means still running.
 *
 * The check makes one of the three errors `rotationIssues` reports structurally impossible,
 * which is worth having now that a browser can write here.
 */
export const rotations = pgTable(
  'rotations',
  {
    name: text('name').primaryKey(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [check('rotations_ordered', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`)],
);

/* ------------------------------------------------------- dashboard auth */

/**
 * Replaces DashboardFeed's CacheService failure counter.
 *
 * A Vercel Function is stateless and shares no cache, so the counter lives in the database
 * -- which is strictly stronger than the original, whose entries could be evicted early and
 * silently reset the lockout. Rows older than the window are deleted on each write.
 */
export const authFailures = pgTable(
  'auth_failures',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    at: timestamp('at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (t) => [index('auth_failures_at_idx').on(t.at)],
);
