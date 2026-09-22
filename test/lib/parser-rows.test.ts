/**
 * Validation and row building.
 *
 * The shapes exercised here are taken from the real new-format corpus -- including the ways
 * it deviates from the format spec -- with synthetic names. A parade state is a report a
 * person typed at 0700; the rules being tested are mostly about not "improving" it.
 */
import { describe, expect, test } from 'bun:test';
import { buildRows, validate } from '../../lib/parser/rows.ts';
import type { Extraction, ExtractedPerson } from '../../lib/parser/extraction.ts';

/**
 * Builds a minimal valid extraction, overridden per test.
 *
 * @param overrides Fields to replace.
 * @returns An extraction suitable for validate/buildRows.
 */
function extraction(overrides: Partial<Extraction> = {}): Extraction {
  return {
    rejected: false,
    rejection_reason: null,
    company: 'Archer',
    date: '2026-09-18',
    session: 'FPS',
    parade_time: '07:25',
    units: [
      {
        unit_label: 'Company',
        total_strength: 123,
        total_present: 117,
        officer_strength: 4,
        officer_present: 2,
        wospec_strength: 22,
        wospec_present: 21,
        enlistee_strength: 97,
        enlistee_present: 94,
        section_counts: [],
      },
    ],
    command_team: [],
    personnel: [],
    ...overrides,
  };
}

/**
 * Builds a personnel entry with sensible defaults.
 *
 * @param overrides Fields to replace.
 * @returns A personnel entry.
 */
function person(overrides: Partial<ExtractedPerson> = {}): ExtractedPerson {
  return {
    unit_label: 'PL 1',
    entry_index: 1,
    reason_category: 'Att C',
    four_d: null,
    rank: 'REC',
    name: 'TAN AH KOW',
    duty_type: 'MC',
    sub_reason: null,
    report_sick_type: null,
    num_days: 3,
    is_permanent: false,
    start_date: '2026-09-16',
    end_date: '2026-09-18',
    start_time: null,
    in_camp: null,
    location: null,
    source_line: '1. REC TAN AH KOW - 3D MC (160926-180926)',
    ...overrides,
  };
}

const context = { paradeResponseId: 'Archer_2026-09-18_FPS', sourceMessageId: 7, model: 'test-model' };

describe('validate rejects what must not be ingested', () => {
  test('passes a well-formed first parade state', () => {
    expect(validate(extraction())).toBe('');
  });

  test('reports the model’s own rejection reason verbatim', () => {
    const result = validate(
      extraction({ rejected: true, rejection_reason: 'This is a LAST PARADE STATE.' }),
    );
    expect(result).toBe('This is a LAST PARADE STATE.');
  });

  test('still reports something when a rejection carries no reason', () => {
    expect(validate(extraction({ rejected: true, rejection_reason: null }))).not.toBe('');
  });

  test('refuses a last parade state even if the model did not reject it', () => {
    // Belt and braces: the prompt should reject LPS, but only FPS is ever ingested.
    expect(validate(extraction({ session: 'LPS' }))).toMatch(/first parade states/i);
  });

  test('refuses an unknown company rather than guessing', () => {
    expect(validate(extraction({ company: 'Scorpion' }))).toMatch(/Company is missing/);
    expect(validate(extraction({ company: null }))).toMatch(/Company is missing/);
  });

  test('refuses a non-ISO parade date', () => {
    expect(validate(extraction({ date: '180926' }))).toMatch(/not an ISO date/);
  });

  test('refuses a malformed parade time', () => {
    expect(validate(extraction({ parade_time: '0725' }))).toMatch(/not HH:MM/);
  });

  test('requires a company-level strength row', () => {
    const noCompanyRow = extraction({
      units: [{ ...extraction().units[0]!, unit_label: 'PL 1' }],
    });
    expect(validate(noCompanyRow)).toMatch(/No company-level strength row/);
  });

  test('requires every personnel entry to have a name', () => {
    expect(validate(extraction({ personnel: [person({ name: '  ' })] }))).toMatch(/no name/);
  });

  test('refuses an unknown section name', () => {
    expect(validate(extraction({ personnel: [person({ reason_category: 'GUARD DUTY' })] })))
      .toMatch(/Unknown section/);
  });

  test('catches the mistyped-year typo that a plausible-years check would let through', () => {
    // "190936" for "190926" occurs twice in the corpus. A 2036 row passes every naive
    // sanity check and then silently escapes every date filter in the dashboard.
    const result = validate(extraction({ personnel: [person({ end_date: '2036-09-25' })] }));
    expect(result).toMatch(/implausibly far from the parade date/);
  });

  test('allows a genuinely distant future appointment', () => {
    // Appointments a year out are real: the corpus has an MA in December for a September
    // parade state.
    expect(validate(extraction({ personnel: [person({ end_date: '2026-12-10' })] }))).toBe('');
  });
});

describe('buildRows derives only what it must', () => {
  test('carries the submission key and provenance onto every table', () => {
    const rows = buildRows(
      extraction({ personnel: [person()], command_team: [] }),
      context,
    );
    expect(rows.submission.paradeResponseId).toBe('Archer_2026-09-18_FPS');
    expect(rows.submission.sourceMessageId).toBe(7);
    expect(rows.submission.model).toBe('test-model');
    expect(rows.personnel[0]!.paradeResponseId).toBe('Archer_2026-09-18_FPS');
  });

  test('classifies unit blocks so totals are never summed across levels', () => {
    const rows = buildRows(
      extraction({
        units: [
          { ...extraction().units[0]! },
          { ...extraction().units[0]!, unit_label: 'COY HQ' },
          { ...extraction().units[0]!, unit_label: 'PL 7' },
          { ...extraction().units[0]!, unit_label: 'OPR+ASA' },
        ],
      }),
      context,
    );
    expect(rows.strength.map((r) => r.unitType)).toEqual(['Company', 'HQ', 'PLATOON', 'SUBUNIT']);
  });

  test('keeps a tier written as a bare number from implying a strength', () => {
    // Stallion writes "OFFICER: 0" rather than "0/0". Present is 0; strength is unknown.
    const rows = buildRows(
      extraction({
        units: [{ ...extraction().units[0]!, officer_present: 0, officer_strength: null }],
      }),
      context,
    );
    expect(rows.strength[0]!.officerPresent).toBe(0);
    expect(rows.strength[0]!.officerStrength).toBeNull();
  });

  test('takes the stated day count literally even when the dates disagree', () => {
    // "32D EXCUSE SWIMMING (260826-260926)" is 31 days by the calendar. The stated figure
    // is what the unit tracks, so it is what gets stored.
    const rows = buildRows(
      extraction({
        personnel: [person({ num_days: 32, start_date: '2026-08-26', end_date: '2026-09-26' })],
      }),
      context,
    );
    expect(rows.personnel[0]!.numDays).toBe(32);
  });

  test('records permanence as a flag and leaves the day count empty', () => {
    const rows = buildRows(
      extraction({
        personnel: [
          person({
            reason_category: 'Status',
            duty_type: 'PERM EXCUSE PYROTECHNICS',
            is_permanent: true,
            num_days: null,
            start_date: '2026-07-10',
            end_date: null,
          }),
        ],
      }),
      context,
    );
    expect(rows.personnel[0]!.isPermanent).toBe(true);
    expect(rows.personnel[0]!.numDays).toBeNull();
    expect(rows.personnel[0]!.endDate).toBeNull();
  });

  test('normalises the identity key and the 4D attribute', () => {
    const rows = buildRows(
      extraction({ personnel: [person({ name: 'Tan Ah Kow, Junior', four_d: ' a1105 ' })] }),
      context,
    );
    expect(rows.personnel[0]!.nameKey).toBe('TAN AH KOW JUNIOR');
    expect(rows.personnel[0]!.fourD).toBe('A1105');
  });

  test('treats a NIL placeholder as no 4D', () => {
    const rows = buildRows(extraction({ personnel: [person({ four_d: 'NIL' })] }), context);
    expect(rows.personnel[0]!.fourD).toBeNull();
  });

  test('keeps a report-sick sub-type only where it means something', () => {
    const rows = buildRows(
      extraction({
        personnel: [
          person({ reason_category: 'Report Sick', report_sick_type: 'RSO' }),
          person({ reason_category: 'Status', report_sick_type: 'RSO' }),
        ],
      }),
      context,
    );
    expect(rows.personnel[0]!.reportSickType).toBe('RSO');
    expect(rows.personnel[1]!.reportSickType).toBeNull();
  });

  test('keeps duty and sub-reason apart', () => {
    const rows = buildRows(
      extraction({
        personnel: [person({ duty_type: 'MA', sub_reason: 'Sleep medicine', start_time: '09:30' })],
      }),
      context,
    );
    expect(rows.personnel[0]!.dutyType).toBe('MA');
    expect(rows.personnel[0]!.subReason).toBe('Sleep medicine');
    expect(rows.personnel[0]!.startTime).toBe('09:30');
  });

  test('records an out-of-camp marker', () => {
    const rows = buildRows(extraction({ personnel: [person({ in_camp: false })] }), context);
    expect(rows.personnel[0]!.inCamp).toBe(false);
  });

  test('preserves the source line so a surprising row can be traced', () => {
    const rows = buildRows(extraction({ personnel: [person()] }), context);
    expect(rows.personnel[0]!.sourceLine).toContain('3D MC');
  });
});

describe('command roster', () => {
  test('splits role kind from the sub-unit it commands', () => {
    const rows = buildRows(
      extraction({
        command_team: [
          { role_kind: 'CDO', unit_label: null, rank: '2LT', name: 'TAN AH KOW', is_vacant: false },
          { role_kind: 'PDS', unit_label: '7', rank: '3SG', name: 'LIM AH SENG', is_vacant: false },
          { role_kind: 'PDS', unit_label: 'SIG', rank: '3SG', name: 'WONG AH HUAT', is_vacant: false },
          { role_kind: 'PDS', unit_label: 'OPR+ASA', rank: null, name: null, is_vacant: true },
        ],
      }),
      context,
    );
    expect(rows.roster.map((r) => [r.roleKind, r.unitLabel])).toEqual([
      ['CDO', null],
      ['PDS', '7'],
      ['PDS', 'SIG'],
      ['PDS', 'OPR+ASA'],
    ]);
  });

  test('records an unfilled appointment as vacant rather than dropping it', () => {
    // The corpus contains "PDS MED: -". Knowing the post is empty differs from not knowing.
    const rows = buildRows(
      extraction({
        command_team: [
          { role_kind: 'PDS', unit_label: 'MED', rank: null, name: null, is_vacant: true },
        ],
      }),
      context,
    );
    expect(rows.roster[0]!.isVacant).toBe(true);
    expect(rows.roster[0]!.nameKey).toBeNull();
  });

  test('treats a nameless appointment as vacant even if the model did not say so', () => {
    const rows = buildRows(
      extraction({
        command_team: [
          { role_kind: 'PDS', unit_label: 'MED', rank: null, name: null, is_vacant: false },
        ],
      }),
      context,
    );
    expect(rows.roster[0]!.isVacant).toBe(true);
  });
});

describe('section counts', () => {
  test('stores what the header claimed, including a missing number', () => {
    const rows = buildRows(
      extraction({
        units: [
          {
            ...extraction().units[0]!,
            unit_label: 'COY HQ',
            section_counts: [
              { reason_category: 'Att C', stated_count: 0 },
              { reason_category: 'Others', stated_count: null },
            ],
          },
        ],
      }),
      context,
    );
    expect(rows.sectionCounts).toEqual([
      { paradeResponseId: context.paradeResponseId, unitLabel: 'COY HQ', reasonCategory: 'Att C', statedCount: 0 },
      { paradeResponseId: context.paradeResponseId, unitLabel: 'COY HQ', reasonCategory: 'Others', statedCount: null },
    ]);
  });

  test('de-duplicates a repeated header instead of aborting the whole submission', () => {
    // The composite primary key would reject the batch, losing a real parade state over a
    // cosmetic duplication.
    const rows = buildRows(
      extraction({
        units: [
          {
            ...extraction().units[0]!,
            unit_label: 'PL 1',
            section_counts: [
              { reason_category: 'Status', stated_count: 2 },
              { reason_category: 'Status', stated_count: 3 },
            ],
          },
        ],
      }),
      context,
    );
    expect(rows.sectionCounts).toHaveLength(1);
    expect(rows.sectionCounts[0]!.statedCount).toBe(2);
  });
});

describe('placeholder dashes', () => {
  test('a vacant appointment written as a dash does not become a rank', () => {
    // Hercules files "PDS MED: -". The model returns the dash faithfully; storing it would
    // put "-" on the ORBAT page beside real ranks.
    const rows = buildRows(
      extraction({
        command_team: [
          { role_kind: 'PDS', unit_label: 'MED', rank: '-', name: '-', is_vacant: true },
        ],
      }),
      context,
    );
    expect(rows.roster[0]!.rank).toBeNull();
    expect(rows.roster[0]!.name).toBeNull();
    expect(rows.roster[0]!.isVacant).toBe(true);
  });

  test('keeps a real rank and name untouched', () => {
    const rows = buildRows(
      extraction({
        command_team: [
          { role_kind: 'CDO', unit_label: null, rank: '2LT', name: 'TAN AH KOW', is_vacant: false },
        ],
      }),
      context,
    );
    expect(rows.roster[0]!.rank).toBe('2LT');
    expect(rows.roster[0]!.name).toBe('TAN AH KOW');
    expect(rows.roster[0]!.isVacant).toBe(false);
  });
});
