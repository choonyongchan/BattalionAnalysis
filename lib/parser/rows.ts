/**
 * Turns an extraction into the rows that go into the database.
 *
 * This layer derives almost nothing, on purpose. The parade state is a report a duty
 * commander typed, and its internal arithmetic is known to disagree with itself: three of
 * fifteen audited messages had strength figures that did not add up, section headers
 * disagreed with the lines beneath them 14 times in 391, and a stated day-count routinely
 * differs from the date range printed beside it. Reconciling any of that here would replace
 * a fact the unit reported with a number this code invented.
 *
 * So: what the message says is stored as the message says it. Disagreements are preserved
 * (see `section_counts`) and surfaced as data-quality findings in the dashboard, not fixed
 * during ingestion.
 *
 * The one exception is a wrong year digit -- "190936" for "190926" -- which the prompt
 * corrects and `validate` catches if it slips through, because a 2036 row silently escapes
 * every date filter in the dashboard rather than looking wrong.
 */
import { normaliseFourD, normaliseName, unitTypeOf } from '../domain.ts';
import { COMPANIES, REASON_CATEGORIES } from '../domain.ts';
import type { Extraction } from './extract.ts';

/** How far from the parade date a stated date may be before it is treated as a typo. */
const MAX_DATE_DRIFT_DAYS = 550;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HH_MM = /^\d{2}:\d{2}$/;

/** The rows one message produces, ready for a single `db.batch`. */
export interface BuiltRows {
  submission: {
    paradeResponseId: string;
    company: string;
    date: string;
    session: string;
    paradeTime: string | null;
    sourceMessageId: number | null;
    model: string | null;
  };
  strength: Array<Record<string, unknown>>;
  personnel: Array<Record<string, unknown>>;
  roster: Array<Record<string, unknown>>;
  sectionCounts: Array<Record<string, unknown>>;
}

/** Context the row builder needs beyond the extraction itself. */
export interface BuildContext {
  paradeResponseId: string;
  sourceMessageId: number | null;
  model: string | null;
}

/**
 * Checks an extraction is structurally usable before any row is built.
 *
 * Returns a human-readable reason rather than throwing, because the reason is written
 * verbatim into `raw_messages.error` and read by whoever investigates. Structural only --
 * it never judges whether the numbers are self-consistent.
 *
 * @param extraction What the model returned.
 * @returns An empty string when the extraction is usable, else the reason it is not.
 */
export function validate(extraction: Extraction): string {
  if (extraction.rejected) {
    return extraction.rejection_reason || 'Message was rejected without a stated reason.';
  }
  if (!extraction.company || !COMPANIES.includes(extraction.company as never)) {
    return `Company is missing or not one of ${COMPANIES.join(', ')}.`;
  }
  if (!extraction.date || !ISO_DATE.test(extraction.date)) {
    return `Parade date is missing or not an ISO date: ${String(extraction.date)}.`;
  }
  if (extraction.session !== 'FPS') {
    return `Only first parade states are ingested; this one is ${String(extraction.session)}.`;
  }
  if (extraction.parade_time && !HH_MM.test(extraction.parade_time)) {
    return `Parade time is not HH:MM: ${extraction.parade_time}.`;
  }

  const companyRow = extraction.units.find((unit) => unitTypeOf(unit.unit_label) === 'Company');
  if (!companyRow) {
    return 'No company-level strength row was found.';
  }

  for (const person of extraction.personnel) {
    if (!person.name || !person.name.trim()) {
      return 'A personnel entry has no name.';
    }
    if (!REASON_CATEGORIES.includes(person.reason_category as never)) {
      return `Unknown section "${person.reason_category}" for ${person.name}.`;
    }
    for (const field of ['start_date', 'end_date'] as const) {
      const value = person[field];
      if (value && !ISO_DATE.test(value)) {
        return `${field} for ${person.name} is not an ISO date: ${value}.`;
      }
      if (value && driftDays(value, extraction.date) > MAX_DATE_DRIFT_DAYS) {
        return `${field} for ${person.name} is ${value}, implausibly far from the parade date ${extraction.date} -- most likely a mistyped year.`;
      }
    }
  }
  return '';
}

/**
 * Builds every row for one submission.
 *
 * @param extraction A validated extraction.
 * @param context The submission key and provenance for the rows.
 * @returns Insert-shaped objects for each table.
 */
export function buildRows(extraction: Extraction, context: BuildContext): BuiltRows {
  const key = context.paradeResponseId;

  const submission = {
    paradeResponseId: key,
    company: extraction.company as string,
    date: extraction.date as string,
    session: extraction.session as string,
    paradeTime: extraction.parade_time,
    sourceMessageId: context.sourceMessageId,
    model: context.model,
  };

  const strength = extraction.units.map((unit) => ({
    paradeResponseId: key,
    unitLabel: unit.unit_label,
    unitType: unitTypeOf(unit.unit_label),
    // The only defaulting in this module. A strength block with no figures at all is
    // meaningless, and NOT NULL on the totals is what stops one being stored.
    totalStrength: unit.total_strength ?? 0,
    totalPresent: unit.total_present ?? 0,
    officerStrength: unit.officer_strength,
    officerPresent: unit.officer_present,
    wospecStrength: unit.wospec_strength,
    wospecPresent: unit.wospec_present,
    enlisteeStrength: unit.enlistee_strength,
    enlisteePresent: unit.enlistee_present,
  }));

  /*
   * Section counts are de-duplicated on (unit, category) because the table's primary key is
   * that pair. A message that prints the same header twice inside one block would otherwise
   * abort the whole batch -- losing a real parade state over a cosmetic duplication.
   */
  const seenSections = new Set<string>();
  const sectionCounts: Array<Record<string, unknown>> = [];
  for (const unit of extraction.units) {
    for (const section of unit.section_counts ?? []) {
      const pair = JSON.stringify([unit.unit_label, section.reason_category]);
      if (seenSections.has(pair)) continue;
      seenSections.add(pair);
      sectionCounts.push({
        paradeResponseId: key,
        unitLabel: unit.unit_label,
        reasonCategory: section.reason_category,
        statedCount: section.stated_count,
      });
    }
  }

  const personnel = extraction.personnel.map((person) => ({
    paradeResponseId: key,
    unitLabel: person.unit_label,
    entryIndex: person.entry_index,
    reasonCategory: person.reason_category,
    fourD: normaliseFourD(person.four_d),
    rank: person.rank,
    name: person.name.trim(),
    nameKey: normaliseName(person.name),
    dutyType: person.duty_type,
    subReason: person.sub_reason,
    reportSickType: person.reason_category === 'Report Sick' ? person.report_sick_type : null,
    numDays: person.num_days,
    isPermanent: Boolean(person.is_permanent),
    startDate: person.start_date,
    endDate: person.end_date,
    startTime: person.start_time,
    inCamp: person.in_camp,
    location: person.location,
    sourceLine: person.source_line,
  }));

  const roster = extraction.command_team.map((member) => {
    // A vacant appointment is written as "CDS: -", and the model faithfully returns the
    // dash. Storing it as a rank would put "-" on the ORBAT page beside real ranks.
    const rank = blankToNull(member.rank);
    const name = blankToNull(member.name);
    return {
      paradeResponseId: key,
      roleKind: member.role_kind,
      unitLabel: blankToNull(member.unit_label),
      rank,
      name,
      nameKey: name ? normaliseName(name) : null,
      isVacant: Boolean(member.is_vacant) || !name,
    };
  });

  return { submission, strength, personnel, roster, sectionCounts };
}

/** Placeholders a filer writes to mean "nothing here". */
const BLANK_PLACEHOLDERS = new Set(['', '-', '--', '–', '—', 'NIL', 'N/A', 'NA']);

/**
 * Treats a placeholder dash as an absent value.
 *
 * @param value A field as the model returned it.
 * @returns The trimmed value, or null when it carries no information.
 */
function blankToNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return BLANK_PLACEHOLDERS.has(trimmed.toUpperCase()) ? null : trimmed;
}

/**
 * Days between two ISO dates, unsigned.
 *
 * @param a An ISO date.
 * @param b An ISO date.
 * @returns The absolute difference in whole days, or 0 if either cannot be parsed.
 */
function driftDays(a: string, b: string): number {
  const first = Date.parse(`${a}T00:00:00Z`);
  const second = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(second)) return 0;
  return Math.abs(first - second) / 86_400_000;
}
