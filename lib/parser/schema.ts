/**
 * The Structured Outputs JSON Schema the model must answer with.
 *
 * Every enum here is read from `db/schema.ts` rather than retyped, so a value the model is
 * allowed to emit is by construction a value the database will accept. The old system kept
 * three hand-maintained copies of this vocabulary in sync with a test; this removes the
 * copies instead of testing them.
 *
 * OpenAI strict mode has three rules that are easy to break and fail at request time, not
 * at review time:
 *   1. every property must appear in `required` -- optionality is expressed by allowing
 *      null in the type, never by omitting the key;
 *   2. every object must set `additionalProperties: false`;
 *   3. nullability is `type: [t, 'null']`, never a `nullable` flag.
 * `test/lib/parser-schema.test.ts` walks the whole tree asserting all three.
 */
import {
  COMPANIES,
  REASON_CATEGORIES,
  REPORT_SICK_TYPES,
  ROLE_KINDS,
  SESSIONS,
} from '../domain.ts';

/** A required string property. */
const str = { type: 'string' } as const;
/** A property that is a string or explicitly absent. */
const nullableStr = { type: ['string', 'null'] } as const;
/** A property that is an integer or explicitly absent. */
const nullableInt = { type: ['integer', 'null'] } as const;

/**
 * Builds the response schema.
 *
 * A function rather than a constant so the enum arrays are read at call time, which keeps
 * the "one source of truth" property honest if the schema module is ever imported before
 * the database schema module finishes evaluating.
 *
 * @returns The `json_schema` value for an OpenAI `response_format`.
 */
export function buildResponseSchema() {
  return {
    name: 'parade_state',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['rejected', 'rejection_reason', 'company', 'date', 'session', 'parade_time', 'units', 'command_team', 'personnel'],
      properties: {
        /**
         * The model's own verdict on whether this message is a first parade state in the
         * current format. Asking for it explicitly is what lets a LAST PARADE STATE or an
         * old-format message be recorded as rejected, with a reason, instead of being
         * half-parsed into plausible-looking rows.
         */
        rejected: { type: 'boolean' },
        rejection_reason: nullableStr,

        company: { type: ['string', 'null'], enum: [...COMPANIES, null] },
        /** ISO `yyyy-MM-dd`, converted from the message's `DDMMYY`. */
        date: nullableStr,
        session: { type: ['string', 'null'], enum: [...SESSIONS, null] },
        /** `HH:MM` from the `TIME: HHMM` header. */
        parade_time: nullableStr,

        units: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'unit_label',
              'total_strength',
              'total_present',
              'officer_strength',
              'officer_present',
              'wospec_strength',
              'wospec_present',
              'enlistee_strength',
              'enlistee_present',
              'section_counts',
            ],
            properties: {
              /** Verbatim: `Company`, `COY HQ`, `PL 7`, `SIG`, `OPR+ASA`, `MED`. */
              unit_label: str,
              total_strength: nullableInt,
              total_present: nullableInt,
              officer_strength: nullableInt,
              officer_present: nullableInt,
              wospec_strength: nullableInt,
              wospec_present: nullableInt,
              enlistee_strength: nullableInt,
              enlistee_present: nullableInt,
              /** What each section header claims, kept beside what was listed. */
              section_counts: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['reason_category', 'stated_count'],
                  properties: {
                    reason_category: { type: 'string', enum: [...REASON_CATEGORIES] },
                    stated_count: nullableInt,
                  },
                },
              },
            },
          },
        },

        command_team: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['role_kind', 'unit_label', 'rank', 'name', 'is_vacant'],
            properties: {
              role_kind: { type: 'string', enum: [...ROLE_KINDS] },
              /** `1`, `7`, `SIG`, `PNR`. Null for CDO/CDS/COS. */
              unit_label: nullableStr,
              rank: nullableStr,
              name: nullableStr,
              /** True for an appointment written as `-`, meaning unfilled. */
              is_vacant: { type: 'boolean' },
            },
          },
        },

        personnel: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: [
              'unit_label',
              'entry_index',
              'reason_category',
              'four_d',
              'rank',
              'name',
              'duty_type',
              'sub_reason',
              'report_sick_type',
              'num_days',
              'is_permanent',
              'start_date',
              'end_date',
              'start_time',
              'in_camp',
              'location',
              'source_line',
            ],
            properties: {
              unit_label: str,
              entry_index: nullableInt,
              reason_category: { type: 'string', enum: [...REASON_CATEGORIES] },
              four_d: nullableStr,
              rank: nullableStr,
              name: str,
              /** The duty: `MC`, `LD`, `EXCUSE FLEGS`, `MA`, `ANNUAL LEAVE`, `IMT`. */
              duty_type: nullableStr,
              /** The detail in parentheses: `Fever`, `Sleep medicine`. */
              sub_reason: nullableStr,
              report_sick_type: { type: ['string', 'null'], enum: [...REPORT_SICK_TYPES, null] },
              num_days: nullableInt,
              is_permanent: { type: 'boolean' },
              start_date: nullableStr,
              end_date: nullableStr,
              /** `HH:MM` for an appointment time. */
              start_time: nullableStr,
              in_camp: { type: ['boolean', 'null'] },
              location: nullableStr,
              /** The verbatim line, for provenance. */
              source_line: nullableStr,
            },
          },
        },
      },
    },
  };
}
