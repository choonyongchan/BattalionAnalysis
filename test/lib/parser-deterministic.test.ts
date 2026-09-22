/**
 * The template parser, on synthetic messages shaped like each company's real filings.
 * NAMES ARE SYNTHETIC: no real soldier's name, 4D number or diagnosis may appear here.
 */
import { describe, expect, test } from 'bun:test';
import { parseEntry, parseParadeState, toIsoDate } from '../../lib/parser/deterministic.ts';
import { validate } from '../../lib/parser/rows.ts';

const TODAY = '2026-09-18';
const WHERE = { unit_label: 'PL 1', reason_category: 'Status' };

/**
 * Parses one line and returns its single entry.
 *
 * @param line The personnel line.
 * @param section The section it sits under.
 * @returns The entry and the problems.
 */
function one(line: string, section = 'Status') {
  const { entries, problems } = parseEntry(line, TODAY, { ...WHERE, reason_category: section });
  expect(entries).toHaveLength(1);
  return { ...entries[0]!, problems };
}

/** Archer-style: full template, command team with a vacancy, three blocks. */
const ARCHER = `40 SAR ARCHER COMPANY
FIRST PARADE STATE
DATE: 180926 TIME: 0725
CDO: 2LT TAN AH KOW
CDS: 2SG LIM AH SENG
COS: -
PDS 1: 3SG WONG AH HUAT
PDS OPR+ASA: <RANK> <NAME>
================================
COMPANY: 45/50
OFFICER: 2/3
WOSPEC: 5/5
ENLISTEE: 38/42
================================
COY HQ: 10/10
OFFICER: 1/1
WOSPEC: 3/3
ENLISTEE: 6/6
ATT C: 0
STATUS: 1
1. 1101 REC ONG AH BENG - PERM EXCUSE RMJ, HEAVY LOADS, KNEELING (SINCE 100726)
REPORT SICK: 0
MA: 1
1. 1102 REC KOH AH MENG - MA (Dental) (011026 1045) @ SGH
OFF/LEAVE: 0
OTHERS: 0
--------------------------------
PL 1: 35/40
OFFICER: 1/2
WOSPEC: 2/2
ENLISTEE: 32/36
ATT C: 2
1. 1210 REC TEO AH LEK - 3D MC (160926-180926) - Fever @ Sengkang GH
2. 1211 REC NG AH HOCK - 2D MC (170926-180926) OUT
STATUS: 1
1. 1212 REC CHUA AH TECK - 84D EXCUSE STAY IN (250726-161026)
REPORT SICK: 1
1. 1213 REC GOH AH KIAT - RSI (180926) - Runny nose, cough
MA: 0
OFF/LEAVE: 1
1. 2LT RAJ KUMAR - LEAVE (170926-190926)
OTHERS: 1
1. 1214 REC YEO AH CHYE - GUARD DUTY (180626 1630-190626 0800) IN`;

describe('a full template message', () => {
  const { extraction, problems } = parseParadeState(ARCHER, TODAY);

  test('is parsed with confidence and passes validation', () => {
    expect(problems).toEqual([]);
    expect(validate(extraction)).toBe('');
  });

  test('reads the header', () => {
    expect(extraction).toMatchObject({ company: 'Archer', date: '2026-09-18', parade_time: '07:25', session: 'FPS' });
  });

  test('reads every block, tier and stated count', () => {
    expect(extraction.units.map((u) => u.unit_label)).toEqual(['Company', 'COY HQ', 'PL 1']);
    expect(extraction.units[2]).toMatchObject({ total_present: 35, total_strength: 40, officer_present: 1, officer_strength: 2 });
    expect(extraction.units[2]!.section_counts).toHaveLength(6);
    expect(extraction.units[2]!.section_counts[0]).toEqual({ reason_category: 'Att C', stated_count: 2 });
  });

  test('reads the command team, with dashes and placeholders as vacancies', () => {
    expect(extraction.command_team).toEqual([
      { role_kind: 'CDO', unit_label: null, rank: '2LT', name: 'TAN AH KOW', is_vacant: false },
      { role_kind: 'CDS', unit_label: null, rank: '2SG', name: 'LIM AH SENG', is_vacant: false },
      { role_kind: 'COS', unit_label: null, rank: null, name: null, is_vacant: true },
      { role_kind: 'PDS', unit_label: '1', rank: '3SG', name: 'WONG AH HUAT', is_vacant: false },
      { role_kind: 'PDS', unit_label: 'OPR+ASA', rank: null, name: null, is_vacant: true },
    ]);
  });

  test('files every line under its block and section', () => {
    expect(extraction.personnel.map((p) => [p.unit_label, p.reason_category, p.entry_index])).toEqual([
      ['COY HQ', 'Status', 1],
      ['COY HQ', 'MA', 1],
      ['PL 1', 'Att C', 1],
      ['PL 1', 'Att C', 2],
      ['PL 1', 'Status', 1],
      ['PL 1', 'Report Sick', 1],
      ['PL 1', 'Off/Leave', 1],
      ['PL 1', 'Others', 1],
    ]);
  });
});

describe('personnel lines', () => {
  test('splits the full grammar, trailing reason and location included', () => {
    expect(one('1. 1210 REC TEO AH LEK - 3D MC (160926-180926) OUT - Fever @ Sengkang GH', 'Att C')).toMatchObject({
      entry_index: 1,
      four_d: '1210',
      rank: 'REC',
      name: 'TEO AH LEK',
      duty_type: 'MC',
      sub_reason: 'Fever',
      num_days: 3,
      start_date: '2026-09-16',
      end_date: '2026-09-18',
      in_camp: false,
      location: 'Sengkang GH',
      problems: [],
    });
  });

  test('reads a bracketed detail and an appointment time', () => {
    expect(one('2. A2208 CPL LIM AH SENG - MA (Sleep medicine) (100926 1030) OUT @ National Skin Centre', 'MA')).toMatchObject({
      four_d: 'A2208',
      duty_type: 'MA',
      sub_reason: 'Sleep medicine',
      start_date: '2026-09-10',
      end_date: '2026-09-10',
      start_time: '10:30',
      in_camp: false,
      location: 'National Skin Centre',
    });
  });

  test('keeps a condition with no duty as the sub-reason in medical sections', () => {
    expect(one('1. 1401 PTE TAN AH KOW - High Fever, Flu, Tonsillitis (160926-180926) OUT', 'Att C')).toMatchObject({
      duty_type: null,
      sub_reason: 'High Fever, Flu, Tonsillitis',
      problems: [],
    });
  });

  test('splits a detail from dates sharing one bracket', () => {
    expect(one('4. 3SG WONG AH HUAT - 2D MC (laceration on chin 170926-180926)', 'Att C')).toMatchObject({
      duty_type: 'MC',
      sub_reason: 'laceration on chin',
      start_date: '2026-09-17',
      end_date: '2026-09-18',
    });
  });

  test('reads report-sick types, and an unfilled <RSI/RSO> as unknown', () => {
    expect(one('- 2208 PTE TAN AH KOW (RSO) (180926) OUT', 'Report Sick')).toMatchObject({ entry_index: null, report_sick_type: 'RSO', in_camp: false });
    expect(one('1. 2105 REC GOH AH KIAT - RSI (020926) - Runny nose', 'Report Sick')).toMatchObject({ report_sick_type: 'RSI', duty_type: null, sub_reason: 'Runny nose' });
    expect(one('1. PTE TAN AH KOW - <RSI/RSO> (UNTIL 180926) - Fever', 'Report Sick')).toMatchObject({ report_sick_type: null, sub_reason: 'Fever', problems: [] });
  });

  test('reads every date form', () => {
    expect(one('1. PTE TAN - GUARD DUTY (180626 1630-190626 0800) IN', 'Others')).toMatchObject({ start_date: '2026-06-18', end_date: '2026-06-19', start_time: '16:30', num_days: 1, in_camp: true });
    expect(one('1. PTE TAN - EXCUSE FLEGS (SINCE 100726)')).toMatchObject({ start_date: '2026-07-10', end_date: null, is_permanent: true });
    expect(one('1. PTE TAN - EXCUSE FLAGS (UNTIL 170926)')).toMatchObject({ start_date: null, end_date: '2026-09-17', is_permanent: false });
    expect(one('1. PTE TAN - 2D MC (160926 - 180926)', 'Att C')).toMatchObject({ start_date: '2026-09-16', end_date: '2026-09-18' });
  });

  test('marks PERM as permanent with no day count', () => {
    expect(one('1. PTE KOH AH MENG - PERM EXCUSE PT, STAY IN')).toMatchObject({ duty_type: 'EXCUSE PT, STAY IN', is_permanent: true, num_days: null, in_camp: null });
  });

  test('does not read "STAY IN" as the in-camp marker', () => {
    expect(one('1. CPL ONG AH BENG - EXCUSE STAY IN (150926-271026)')).toMatchObject({ duty_type: 'EXCUSE STAY IN', in_camp: null });
  });

  test('takes the stated day count even when the dates disagree', () => {
    expect(one('8. REC TEO AH LEK - 32D EXCUSE SWIMMING (010926-300926)')).toMatchObject({ num_days: 32 });
  });

  test('splits two authorisations with their own dates, but not activities sharing one range', () => {
    const two = parseEntry('1. 3SG PER AH KAI - 5D MC (130926 - 170926), 2D MC (170926 - 180926)', TODAY, WHERE);
    expect(two.entries.map((e) => [e.name, e.num_days, e.start_date, e.end_date])).toEqual([
      ['PER AH KAI', 5, '2026-09-13', '2026-09-17'],
      ['PER AH KAI', 2, '2026-09-17', '2026-09-18'],
    ]);
    expect(one('3. 1307 PTE TAN - Light duty, Excuse Handling of firearms (160926-180926)')).toMatchObject({ duty_type: 'Light duty, Excuse Handling of firearms' });
  });

  test('tolerates the deviations real filers make', () => {
    expect(one('3. 3SG WONG AH HUAT -2D MC (160926-170926)', 'Att C')).toMatchObject({ name: 'WONG AH HUAT', duty_type: 'MC', num_days: 2 });
    expect(one('4. PTE LIM AH SENG 2D Compassionate leave (170926-180926)', 'Off/Leave')).toMatchObject({ name: 'LIM AH SENG', duty_type: 'Compassionate leave' });
    expect(one('2LT KUMAR - IMT', 'Others')).toMatchObject({ entry_index: null, rank: '2LT', name: 'KUMAR', duty_type: 'IMT' });
    expect(one('1. 2LT TAN AH KOW (130926 - 200926)', 'Others')).toMatchObject({ name: 'TAN AH KOW', duty_type: null, start_date: '2026-09-13' });
    expect(one('3. CPT(DR) LEE AH MUI - Excuse stay in (190926-200926)')).toMatchObject({ rank: 'CPT(DR)', name: 'LEE AH MUI' });
    expect(one('1. 1SG TAN AH KOW- COURSE (220626-040926) OUT', 'Others')).toMatchObject({ name: 'TAN AH KOW', duty_type: 'COURSE' });
    expect(one('1. <4D> <RANK> TAN AH KOW - 2D LD (010926-020926)')).toMatchObject({ four_d: null, rank: null, name: 'TAN AH KOW', duty_type: 'LD' });
  });

  test('accepts any duty text under OTHERS, the template catch-all', () => {
    expect(one('2. PTE TAN AH KOW - BAIL REPORTING (180926)', 'Others')).toMatchObject({ duty_type: 'BAIL REPORTING', problems: [] });
  });

  test('reads compassionate leave as a duty', () => {
    expect(one('1. 7103 PTE TAN AH KOW - COMPASSIONATE (200926-220926)', 'Off/Leave')).toMatchObject({
      duty_type: 'COMPASSIONATE',
      start_date: '2026-09-20',
      problems: [],
    });
  });

  test('reads an appointment whose time is still TBC', () => {
    expect(one('1. 7102 PTE TAN AH KOW - MA (Eczema checks) (260127 TBC) @ SKH', 'MA')).toMatchObject({
      sub_reason: 'Eczema checks',
      start_date: '2027-01-26',
      start_time: null,
      location: 'SKH',
      problems: [],
    });
  });

  test('reads dates written without brackets at the end of the duty', () => {
    expect(one('2. 3SG TAN AH KOW - OFF IN LIEU 210926', 'Off/Leave')).toMatchObject({
      duty_type: 'OFF IN LIEU',
      start_date: '2026-09-21',
      end_date: '2026-09-21',
      problems: [],
    });
  });

  test('keeps OTHERS free text whole, reading a date inside it', () => {
    expect(one('1. REC TAN AH KOW - coming back 150926 morning', 'Others')).toMatchObject({
      duty_type: 'coming back 150926 morning',
      start_date: '2026-09-15',
      problems: [],
    });
  });

  test('ends the name at PERM when there is no dash', () => {
    expect(one('2. PTE TAN AH KOW PERM EX FLEGS, PERM EX STAY IN')).toMatchObject({
      name: 'TAN AH KOW',
      is_permanent: true,
      duty_type: 'EX FLEGS, EX STAY IN',
      num_days: null,
      problems: [],
    });
  });

  test('rounds a fractional day count up to whole days', () => {
    expect(one('1.PTE TAN AH KOW 1.5D AL (170926-180926)', 'Off/Leave')).toMatchObject({
      entry_index: 1,
      name: 'TAN AH KOW',
      duty_type: 'AL',
      num_days: 2,
      problems: [],
    });
  });
});

describe('lines the parser will not guess at', () => {
  test.each([
    ['an unknown duty outside OTHERS', '1. PTE TAN - Dental thing (180926)'],
    ['dates it cannot read', '1. PTE TAN - MC x3 (16/09/26 - 18/09/26)'],
    ['a date outside brackets', '1. PTE TAN - MC 2 days from 170926 to 180926'],
    ['an impossible date', '1. PTE TAN - 2D MC (320926-330926)'],
    ['a name it cannot separate', '1. PTE - 2D MC (160926-170926)'],
  ])('flags %s', (_, line) => {
    expect(parseEntry(line, TODAY, WHERE).problems).not.toEqual([]);
  });
});

describe('whole-message decisions', () => {
  test('rejects a last parade state with confidence', () => {
    const result = parseParadeState('40 SAR COUGAR COMPANY\nLAST PARADE STATE\nDATE: 180926 TIME: 0815\nCOMPANY: 1/1', TODAY);
    expect(result).toMatchObject({ problems: [], extraction: { rejected: true, session: 'LPS' } });
  });

  test('rejects chat with confidence', () => {
    expect(parseParadeState('ok noted, thanks', TODAY)).toMatchObject({ problems: [], extraction: { rejected: true } });
  });

  test('rejects the older free-form layout with confidence', () => {
    const old = '40 SAR ARCHER COMPANY FIRST PARADE STATE\nS/N: 1\nR & N: PTE TAN\nReason: MC';
    expect(parseParadeState(old, TODAY)).toMatchObject({ problems: [], extraction: { rejected: true } });
  });

  test('handles a Hercules-style filing: preface line, unfilled blocks, bare tier', () => {
    const hercules = `Parade State

40 SAR HERCULES COMPANY
FIRST PARADE STATE
DATE: 180926 TIME: 0930
COS: PTE TAN AH KOW
================================
COMPANY: 18/25
OFFICER: 0
WOSPEC: <P>/<S>
ENLISTEE: 7/11
================================
SIG: <P>/<S>
OFFICER: <P>/<S>
ATT C: 1
1. 1401 PTE LIM AH SENG – Fever (170926–180926) OUT
STATUS: 0
REPORT SICK: 0
MA: 0
OFF/LEAVE: 0
OTHERS: 0`;
    const { extraction, problems } = parseParadeState(hercules, TODAY);
    expect(problems).toEqual([]);
    expect(extraction.company).toBe('Hercules');
    expect(extraction.units[0]).toMatchObject({ officer_present: 0, officer_strength: null, wospec_present: null });
    expect(extraction.units[1]).toMatchObject({ unit_label: 'SIG', total_present: null });
    expect(extraction.personnel[0]).toMatchObject({ sub_reason: 'Fever', start_date: '2026-09-17', in_camp: false });
  });

  test('reads bare-count blocks and the S/N sub-form nested under REPORT SICK', () => {
    const cougar = `40 SAR COUGAR COMPANY
FIRST PARADE STATE
DATE: 160926 TIME: 0700
CDO: 2LT TAN AH KOW
============================
COMPANY: 38/40
============================
COY HQ: 00
OFFICER: 00/01
ATT C: 00
STATUS: 00
REPORT SICK: 00
S/N: 00
MA: 00
OFF/LEAVE: 00
OTHERS: 00
----------------------------------
Plt 8: 38
OFFICER: 01/01
ATT C: 00
STATUS: 00
REPORT SICK: 01
S/N: 01
  R/N: PTE LIM AH SENG
  REASON: Cough and Flu

MA: 00
OFF/LEAVE: 00
OTHERS: 00`;
    const { extraction, problems } = parseParadeState(cougar, TODAY);
    expect(problems).toEqual([]);
    expect(extraction.rejected).toBe(false);
    expect(extraction.units.map((u) => [u.unit_label, u.total_present, u.total_strength])).toEqual([
      ['Company', 38, 40],
      ['COY HQ', 0, null],
      ['PLT 8', 38, null],
    ]);
    expect(extraction.personnel).toHaveLength(1);
    expect(extraction.personnel[0]).toMatchObject({
      unit_label: 'PLT 8',
      reason_category: 'Report Sick',
      entry_index: 1,
      rank: 'PTE',
      name: 'LIM AH SENG',
      sub_reason: 'Cough and Flu',
    });
  });

  test.each([
    ['no company in the header', ARCHER.replace('ARCHER ', '')],
    ['no FIRST PARADE STATE', ARCHER.replace('FIRST PARADE STATE\n', '')],
    ['no date', ARCHER.replace('DATE: 180926 ', '')],
    ['a line outside any section', ARCHER.replace('ATT C: 0\n', 'some stray remark\nATT C: 0\n')],
    ['a strength block before COMPANY', ARCHER.replace('COMPANY: 45/50', 'PL 0: 1/1\nCOMPANY: 45/50')],
    ['a parade state with no blocks', '40 SAR ARCHER COMPANY\nFIRST PARADE STATE\nDATE: 180926'],
  ])('hands %s to the model', (_, text) => {
    expect(parseParadeState(text, TODAY).problems).not.toEqual([]);
  });
});

describe('toIsoDate', () => {
  test('reads DDMMYY', () => expect(toIsoDate('180926', TODAY)).toBe('2026-09-18'));
  test('pulls a mistyped year to the reference year', () => expect(toIsoDate('190936', TODAY)).toBe('2026-09-19'));
  test('keeps a year either side of the reference', () => expect(toIsoDate('020127', TODAY)).toBe('2027-01-02'));
  test('refuses an impossible date', () => expect(toIsoDate('310226', TODAY)).toBeNull());
});
