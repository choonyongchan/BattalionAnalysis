/**
 * The Drizzle schema: the source of truth for tables and migrations. One write path per table
 * (see docs/architecture_patterns.md). NRIC is deliberately absent; identity is `name_key`.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  COMPANIES,
  OUTCOMES,
  REASON_CATEGORIES,
  REPORT_SICK_TYPES,
  ROLE_KINDS,
  SESSIONS,
  UNIT_TYPES,
} from '../../shared/domain.ts';

const tz = { withTimezone: true, mode: 'string' } as const;

/** Enum values live in `shared/domain.ts`, shared with the parser and the dashboard. */
export const companyEnum = pgEnum('company', COMPANIES);
export const sessionEnum = pgEnum('session', SESSIONS);
export const unitTypeEnum = pgEnum('unit_type', UNIT_TYPES);
export const reasonCategoryEnum = pgEnum('reason_category', REASON_CATEGORIES);
export const roleKindEnum = pgEnum('role_kind', ROLE_KINDS);
export const reportSickTypeEnum = pgEnum('report_sick_type', REPORT_SICK_TYPES);
export const outcomeEnum = pgEnum('outcome', OUTCOMES);

/**
 * One relayed WhatsApp message. `body` holds NRICs and diagnoses: never expose it.
 * processed_at NULL = due; error set = failed; parade_response_id set = parsed.
 */
export const rawMessages = pgTable(
  'raw_messages',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    waMessageId: text('wa_message_id').notNull().unique(),
    body: text('body').notNull(),
    receivedAt: timestamp('received_at', tz).notNull().defaultNow(),
    /** Not an FK: must outlive a replaced submission. */
    paradeResponseId: text('parade_response_id'),
    error: text('error'),
    processedAt: timestamp('processed_at', tz),
    /** Which parser last read the body: `deterministic` or the model id. */
    parser: text('parser'),
    /** How long that parse took, in milliseconds. */
    parseMs: integer('parse_ms'),
  },
  (t) => [index('raw_messages_due_idx').on(t.id).where(sql`${t.processedAt} is null`)],
);

/**
 * One parade state per (company, date, session). The text key `${company}_${date}_${session}`
 * is computable, so a replace fits one `db.batch` without depending on `RETURNING`.
 */
export const paradeSubmissions = pgTable(
  'parade_submissions',
  {
    paradeResponseId: text('parade_response_id').primaryKey(),
    company: companyEnum('company').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    session: sessionEnum('session').notNull(),
    paradeTime: time('parade_time'),
    sourceMessageId: integer('source_message_id').references(() => rawMessages.id, {
      onDelete: 'set null',
    }),
    model: text('model'),
    extractedAt: timestamp('extracted_at', tz).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('parade_submissions_natural_key').on(t.company, t.date, t.session)],
);

/** FK to the parent submission; its rows go when it is replaced. */
const submission = () =>
  text('parade_response_id')
    .notNull()
    .references(() => paradeSubmissions.paradeResponseId, { onDelete: 'cascade' });

/**
 * One unit block, including the `Company` roll-up. No present <= strength check on purpose:
 * real messages break it, and that is a data-quality finding, not an insert error.
 */
export const strengthRows = pgTable(
  'strength_rows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    paradeResponseId: submission(),
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
    check('strength_rows_non_negative', sql`${t.totalStrength} >= 0 and ${t.totalPresent} >= 0`),
  ],
);

/** One person line: `<n>. <4D?> <RANK> <NAME> - <DUTY> (<SUB-REASON>) (<DATES>) [OUT|IN] [@ <LOC>]`. */
export const personnelRows = pgTable(
  'personnel_rows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    paradeResponseId: submission(),
    unitLabel: text('unit_label').notNull(),
    entryIndex: smallint('entry_index'),
    reasonCategory: reasonCategoryEnum('reason_category').notNull(),
    fourD: text('four_d'),
    rank: text('rank'),
    name: text('name').notNull(),
    /** Normalised name: the identity key (`four_d` is unreliable). */
    nameKey: text('name_key').notNull(),
    dutyType: text('duty_type'),
    subReason: text('sub_reason'),
    reportSickType: reportSickTypeEnum('report_sick_type'),
    /** As stated in the message; never derived from the dates. */
    numDays: smallint('num_days'),
    isPermanent: boolean('is_permanent').notNull().default(false),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    startTime: time('start_time'),
    inCamp: boolean('in_camp'),
    location: text('location'),
    /** The verbatim line, for tracing an LLM-extracted row. */
    sourceLine: text('source_line'),
  },
  (t) => [
    index('personnel_rows_submission_idx').on(t.paradeResponseId),
    check('personnel_rows_num_days_non_negative', sql`${t.numDays} is null or ${t.numDays} >= 0`),
  ],
);

/** One command appointment; `is_vacant` records a `-` placeholder. */
export const commandRosterRows = pgTable(
  'command_roster_rows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    paradeResponseId: submission(),
    roleKind: roleKindEnum('role_kind').notNull(),
    unitLabel: text('unit_label'),
    rank: text('rank'),
    name: text('name'),
    nameKey: text('name_key'),
    isVacant: boolean('is_vacant').notNull().default(false),
  },
  (t) => [index('command_roster_rows_submission_idx').on(t.paradeResponseId)],
);

/** The count a section header states; the listed count is `count(*)` over personnel_rows. */
export const sectionCounts = pgTable(
  'section_counts',
  {
    paradeResponseId: submission(),
    unitLabel: text('unit_label').notNull(),
    reasonCategory: reasonCategoryEnum('reason_category').notNull(),
    statedCount: smallint('stated_count'),
  },
  (t) => [
    primaryKey({
      name: 'section_counts_pk',
      columns: [t.paradeResponseId, t.unitLabel, t.reasonCategory],
    }),
  ],
);

/** One FormSG report-sick submission, in sheet column order; `response_id` dedupes redelivery. */
export const reportSickFormsg = pgTable(
  'report_sick_formsg',
  {
    responseId: text('response_id').primaryKey(),
    timestamp: timestamp('timestamp', tz).notNull(),
    rank: text('rank'),
    name: text('name'),
    nameKey: text('name_key').notNull(),
    fourD: text('four_d'),
    unitCoy: text('unit_coy'),
    reportSickTime: time('report_sick_time'),
    reportSickType: reportSickTypeEnum('report_sick_type'),
    reason: text('reason'),
    symptoms: text('symptoms'),
    genuine: boolean('genuine'),
    outcome: outcomeEnum('outcome'),
    mcDays: smallint('mc_days'),
    status1: text('status_1'),
    status1Days: smallint('status_1_days'),
    status2: text('status_2'),
    status2Days: smallint('status_2_days'),
    status3: text('status_3'),
    status3Days: smallint('status_3_days'),
    status4: text('status_4'),
    status4Days: smallint('status_4_days'),
    status5: text('status_5'),
    status5Days: smallint('status_5_days'),
    company: companyEnum('company'),
    /** Singapore-local date of `timestamp`. */
    reportSickDate: date('report_sick_date', { mode: 'string' }).notNull(),
    receivedAt: timestamp('received_at', tz).notNull().defaultNow(),
    symptomCategory: text('symptom_category'),
    symptomOtherText: text('symptom_other_text'),
  },
  (t) => [
    check('report_sick_formsg_mc_days_sane', sql`${t.mcDays} is null or ${t.mcDays} between 0 and 180`),
  ],
);

/** One FormSG Self-Regulated Fitness Training submission; `response_id` dedupes redelivery. */
export const sftFormsg = pgTable(
  'sft_formsg',
  {
    responseId: text('response_id').primaryKey(),
    timestamp: timestamp('timestamp', tz).notNull(),
    rank: text('rank'),
    name: text('name'),
    nameKey: text('name_key').notNull(),
    /** The form's `Company` answer as given; `company` is what it names. */
    unitCoy: text('unit_coy'),
    company: companyEnum('company'),
    groupIc: text('group_ic'),
    pesStatus: text('pes_status'),
    informedCommander: boolean('informed_commander'),
    /** Checkbox selections joined with `; `. */
    exercises: text('exercises'),
    sfabtType: text('sfabt_type'),
    windowConfirmed: boolean('window_confirmed'),
    location: text('location'),
    /** Singapore-local date of `timestamp`. */
    sftDate: date('sft_date', { mode: 'string' }).notNull(),
    receivedAt: timestamp('received_at', tz).notNull().defaultNow(),
  },
  (t) => [index('sft_formsg_date_idx').on(t.sftDate)],
);

/**
 * One row per settings section (`src/model/settings/defaults.js`), edited on the Settings page.
 * No row means the section's default. `version` makes saves optimistic: a save names the
 * version it edited and loses to any save in between.
 */
export const settings = pgTable('settings', {
  section: text('section').primaryKey(),
  value: jsonb('value').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', tz).notNull().defaultNow(),
});
