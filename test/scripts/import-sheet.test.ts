/**
 * The one-time Sheet import: CSV reading, the date formats a Sheet export uses, and that a
 * Sheet cell survives the trip into Neon and back out through `lib/dashboard.ts` unchanged.
 * Names and 4D numbers are synthetic.
 */
import { describe, expect, test } from 'bun:test';
import { personnelNumDays, personnelReason, platoonOf, rosterRole, UNTIMED_MODEL } from '../../lib/dashboard.ts';
import {
  csvRecords,
  groupParadeStates,
  mapAll,
  mapFormSg,
  mapHoliday,
  mapPersonnel,
  mapRoster,
  mapRotation,
  mapStrength,
  parseCsv,
  sheetDate,
  sheetTimestamp,
  splitResponseId,
  type SheetRow,
} from '../../scripts/import-sheet.ts';

describe('parseCsv', () => {
  test('reads quoted commas, doubled quotes and newlines inside a cell', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  test('ignores a byte-order mark and keeps an empty last cell', () => {
    expect(parseCsv(String.fromCharCode(0xfeff) + 'a,b\n1,')).toEqual([
      ['a', 'b'],
      ['1', ''],
    ]);
  });
});

describe('csvRecords', () => {
  test('keys rows by trimmed header, pads short rows, drops blank rows', () => {
    expect(csvRecords(' a ,b\n1\n,\n2,3\n')).toEqual([
      { a: '1', b: '' },
      { a: '2', b: '3' },
    ]);
  });
});

describe('sheetDate', () => {
  test.each([
    ['2026-06-22', '2026-06-22'],
    ['2026-06-22 08:00:00', '2026-06-22'],
    ['22/6/2026', '2026-06-22'],
    ['01/02/2026', '2026-02-01'],
    ['', null],
    ['June 22', null],
    ['6/22/2026', null],
  ])('%p reads as %p', (cell, iso) => {
    expect(sheetDate(cell)).toBe(iso);
  });
});

describe('sheetTimestamp', () => {
  test('reads Singapore wall time as the UTC instant', () => {
    expect(sheetTimestamp('2026-06-22 08:15:23')).toBe('2026-06-22T00:15:23.000Z');
    expect(sheetTimestamp('22/06/2026 7:05:00')).toBe('2026-06-21T23:05:00.000Z');
    expect(sheetTimestamp('2026-06-22')).toBe('2026-06-21T16:00:00.000Z');
    expect(sheetTimestamp('nonsense')).toBeNull();
  });
});

describe('splitResponseId', () => {
  test('names the submission, and refuses what Neon cannot hold', () => {
    expect(splitResponseId('Archer_2026-06-22_FPS')).toEqual({ company: 'Archer', date: '2026-06-22', session: 'FPS' });
    expect(splitResponseId('Scorpion_2026-06-22_FPS')).toBeNull();
    expect(splitResponseId('Archer_22/06/2026_FPS')).toBeNull();
    expect(splitResponseId('Archer_2026-06-22_XPS')).toBeNull();
  });
});

describe('a Sheet cell survives Neon and comes back unchanged', () => {
  test('personnel: platoon, reason and the permanent sentinel', () => {
    const cases: SheetRow[] = [
      { parade_response_id: 'x', platoon: '3', name: 'TEST ONE', reason_category: 'Status', reason: 'Permanent Excuse (Grenades)', num_days: '999' },
      { parade_response_id: 'x', platoon: 'HQ', name: 'TEST TWO', reason_category: 'Att C', reason: 'MC', num_days: '5' },
      { parade_response_id: 'x', platoon: '', name: 'TEST THREE', reason_category: 'Others', reason: 'Guard Duty', num_days: '' },
      // A permanent status the Sheet wrote without the sentinel stays that way.
      { parade_response_id: 'x', platoon: '1', name: 'TEST FOUR', reason_category: 'Status', reason: 'Perm Excuse RMJ', num_days: '' },
    ];
    for (const sheet of cases) {
      const neon = mapPersonnel(sheet) as any;
      expect(platoonOf(neon.unitLabel)).toBe(sheet.platoon!);
      expect(personnelReason({ ...neon, subReason: null, reportSickType: null })).toBe(sheet.reason!);
      expect(personnelNumDays(neon)).toBe(sheet.num_days === '' ? null : Number(sheet.num_days));
    }
  });

  test('strength: platoon label, and a command element becomes a sub-unit', () => {
    const row = { parade_response_id: 'x', platoon: '2', unit_type: 'PLATOON', total_strength: '30', total_present: '28' };
    const neon = mapStrength(row) as any;
    expect(platoonOf(neon.unitLabel)).toBe('2');
    expect(neon).toMatchObject({ unitType: 'PLATOON', totalStrength: 30, totalPresent: 28, officerStrength: null });
    expect(mapStrength({ ...row, platoon: 'COMMANDERS', unit_type: 'COMMAND_ELEMENT' })).toMatchObject({ unitType: 'SUBUNIT' });
    expect(mapStrength({ ...row, total_present: '' })).toBeNull();
  });

  test('roster: PDS3 is stored as PDS of unit 3 and read back as PDS3', () => {
    const neon = mapRoster({ parade_response_id: 'x', role: 'PDS3', rank: '3SG', name: 'TEST PDS' }) as any;
    expect(neon).toMatchObject({ roleKind: 'PDS', unitLabel: '3', nameKey: 'TEST PDS' });
    expect(rosterRole(neon.roleKind, neon.unitLabel)).toBe('PDS3');
    expect(mapRoster({ parade_response_id: 'x', role: 'CDO', name: 'A' })).toMatchObject({ roleKind: 'CDO', unitLabel: null });
    expect(mapRoster({ parade_response_id: 'x', role: 'PDS', name: 'A' })).toBeNull();
    expect(mapRoster({ parade_response_id: 'x', role: 'RSM', name: 'A' })).toBeNull();
  });
});

describe('groupParadeStates', () => {
  const ID = 'Braves_2026-06-22_FPS';
  const strength = [
    { parade_response_id: ID, platoon: 'Company', unit_type: 'Company', total_strength: '100', total_present: '90' },
    { parade_response_id: ID, platoon: '1', unit_type: 'PLATOON', total_strength: '30', total_present: '27' },
    { parade_response_id: 'Braves_2026-06-23_FPS', platoon: '1', unit_type: 'PLATOON', total_strength: '30', total_present: '27' },
    { parade_response_id: 'Scorpion_2026-06-22_FPS', platoon: 'Company', unit_type: 'Company', total_strength: '1', total_present: '1' },
  ];
  const personnel = [{ parade_response_id: ID, platoon: '1', name: 'TEST ONE', reason_category: 'MA', reason: 'Medical Appt' }];
  const roster = [{ parade_response_id: ID, role: 'CDO', rank: '2LT', name: 'TEST CDO' }];

  test('groups by submission, dated by its id and timed by its response row', () => {
    const { groups, tallies } = groupParadeStates({
      strength,
      personnel,
      roster,
      responses: [{ Timestamp: '2026-06-22 07:45:00', parade_response_id: ID, 'Drop your Parade State here': 'never read' }],
    });
    expect([...groups.keys()]).toEqual([ID]);
    const group = groups.get(ID)!;
    expect(group.submission).toEqual({
      paradeResponseId: ID,
      company: 'Braves',
      date: '2026-06-22',
      session: 'FPS',
      model: 'sheet',
      extractedAt: '2026-06-21T23:45:00.000Z',
    });
    expect([group.strength.length, group.personnel.length, group.roster.length]).toEqual([2, 1, 1]);
    expect(tallies.strength).toEqual({ read: 4, rejected: [5] });
    expect(JSON.stringify([...groups.values()])).not.toContain('never read');
  });

  test('a submission with no filing time is marked so its filing time is not charted', () => {
    const { groups } = groupParadeStates({ strength, personnel, roster, responses: [] });
    expect(groups.get(ID)!.submission).toMatchObject({ model: UNTIMED_MODEL, extractedAt: '2026-06-22T00:00:00+08:00' });
  });

  test('a submission with no Company roll-up is not imported', () => {
    const { groups } = groupParadeStates({ strength, personnel, roster, responses: [] });
    expect(groups.has('Braves_2026-06-23_FPS')).toBe(false);
  });
});

describe('mapFormSg', () => {
  const row: SheetRow = {
    Timestamp: '2026-06-22 08:15:23',
    'Response ID': 'resp-1',
    'Download Status': 'Success',
    RANK: 'REC',
    '[Myinfo] Name': 'Test Person',
    '4D Number (REC Only)': '2105',
    'Unit & Coy': '40 SAR / Archer',
    'Report Sick Type': 'RSI',
    'Reason for Reporting Sick (Keep Brief)': 'fever',
    'SingPass Validated NRIC': 'T0000001A',
    'Masked NRIC': 'T****001A',
  };

  test('maps through the webhook mapper, dropping both NRIC columns', () => {
    const mapped = mapFormSg(row)!;
    expect(mapped).toMatchObject({
      responseId: 'resp-1',
      timestamp: '2026-06-22T00:15:23.000Z',
      reportSickDate: '2026-06-22',
      company: 'Archer',
      nameKey: 'TEST PERSON',
    });
    expect(JSON.stringify(mapped)).not.toContain('001A');
  });

  test('needs a response id and a timestamp', () => {
    expect(mapFormSg({ ...row, 'Response ID': '' })).toBeNull();
    expect(mapFormSg({ ...row, Timestamp: '' })).toBeNull();
  });
});

describe('settings tabs', () => {
  test('holidays and rotations map, and bad rows are tallied by CSV row number', () => {
    expect(mapHoliday({ date: '9/8/2026', name: 'National Day' })).toEqual({ date: '2026-08-09', name: 'National Day' });
    expect(mapRotation({ name: 'R1', start_date: '2026-07-01', end_date: '2026-09-30' })).toEqual({
      name: 'R1',
      startDate: '2026-07-01',
      endDate: '2026-09-30',
    });
    const { values, tally } = mapAll(
      [
        { name: 'R1', start_date: '2026-07-01', end_date: '2026-09-30' },
        { name: 'R2', start_date: '2026-10-01', end_date: '2026-09-30' },
      ],
      mapRotation,
    );
    expect(values).toHaveLength(1);
    expect(tally).toEqual({ read: 2, rejected: [3] });
  });
});
