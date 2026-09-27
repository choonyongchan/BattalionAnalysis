/**
 * The one-time Sheet import: CSV reading, the date formats a Sheet export uses, and that a
 * Sheet cell survives the trip into Neon and back out through `lib/dashboard.ts` unchanged.
 * Names and 4D numbers are synthetic.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, spyOn, test } from 'bun:test';
import { reportSickFormsg } from '../../db/schema.ts';
import { personnelNumDays, personnelReason, platoonOf, rosterRole, UNTIMED_MODEL } from '../../lib/dashboard.ts';
import {
  csvRecords,
  groupParadeStates,
  insertNew,
  insertParadeStates,
  mapAll,
  mapFormSg,
  mapPersonnel,
  mapRoster,
  mapStrength,
  parseCsv,
  readTab,
  report,
  sheetDate,
  sheetTimestamp,
  splitResponseId,
  type SheetRow,
} from '../../scripts/import-sheet.ts';
import { countRows, DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';

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
    ['07 May 2026 19:21:00', '2026-05-07'],
    ['3 Sep 2026', '2026-09-03'],
    ['12 Foo 2026', null],
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
    expect(sheetTimestamp('07 May 2026 19:21:00')).toBe('2026-05-07T11:21:00.000Z');
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
    // Row 4 belongs to a submission with no Company roll-up; row 5 to an unknown company.
    expect(tallies.strength).toEqual({ read: 4, rejected: [4, 5] });
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

/**
 * Runs `fn` with console.log captured.
 *
 * @param fn The code to run.
 * @returns The lines it logged.
 */
function captureLog(fn: () => void): string[] {
  const log = spyOn(console, 'log').mockImplementation(() => {});
  try {
    fn();
    return log.mock.calls.map((args) => String(args[0]));
  } finally {
    log.mockRestore();
  }
}

describe('readTab', () => {
  const dir = mkdtempSync(join(tmpdir(), 'import-sheet-'));
  writeFileSync(join(dir, 'Battalion - STRENGTH DATA.CSV'), 'a,b\n1,2\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test('finds the tab by the name its file ends with, ignoring case', () => {
    expect(readTab(dir, 'Strength Data')).toEqual([{ a: '1', b: '2' }]);
  });

  test('a missing tab reads as no rows and says it was skipped', () => {
    let rows: SheetRow[] = [{}];
    expect(captureLog(() => (rows = readTab(dir, 'Command Roster')))).toEqual(['  (no "Command Roster" CSV found; skipped)']);
    expect(rows).toEqual([]);
  });
});

describe('report', () => {
  test('a clean dry run prints only the count read', () => {
    expect(captureLog(() => report('Tab', { read: 3, rejected: [] }, null))).toEqual(['Tab: read 3']);
  });

  test('lists rejected row numbers and what was inserted', () => {
    expect(captureLog(() => report('Tab', { read: 5, rejected: [2, 4] }, 3))).toEqual([
      'Tab: read 5, rejected 2 (rows 2, 4), inserted 3',
    ]);
  });

  test('lists at most twenty rejected rows', () => {
    const rejected = Array.from({ length: 25 }, (_, i) => i + 2);
    const [line] = captureLog(() => report('Tab', { read: 30, rejected }, null));
    expect(line).toContain('rejected 25 (rows 2, 3,');
    expect(line).toContain('21, ...)');
    expect(line).not.toContain('22');
  });
});

describe.skipIf(!hasTestDb)('writing the import to Neon', () => {
  const FIRST = 'Braves_2026-06-22_FPS';
  const SECOND = 'Braves_2026-06-23_FPS';
  const { groups } = groupParadeStates({
    strength: [
      { parade_response_id: FIRST, platoon: 'Company', unit_type: 'Company', total_strength: '100', total_present: '90' },
      { parade_response_id: FIRST, platoon: '1', unit_type: 'PLATOON', total_strength: '30', total_present: '27' },
      { parade_response_id: SECOND, platoon: 'Company', unit_type: 'Company', total_strength: '100', total_present: '95' },
    ],
    personnel: [{ parade_response_id: FIRST, platoon: '1', name: 'TEST ONE', reason_category: 'MA', reason: 'Medical Appt' }],
    roster: [{ parade_response_id: FIRST, role: 'CDO', rank: '2LT', name: 'TEST CDO' }],
    responses: [],
  });

  test('inserts each submission with its rows, and a re-run inserts nothing', async () => {
    const db = await resetTestDb();
    expect(await insertParadeStates(db, groups)).toBe(2);
    expect(await countRows(db, 'parade_submissions')).toBe(2);
    expect(await countRows(db, 'strength_rows', FIRST)).toBe(2);
    expect(await countRows(db, 'personnel_rows', FIRST)).toBe(1);
    expect(await countRows(db, 'command_roster_rows', FIRST)).toBe(1);
    expect(await countRows(db, 'strength_rows', SECOND)).toBe(1);

    expect(await insertParadeStates(db, groups)).toBe(0);
    expect(await countRows(db, 'strength_rows')).toBe(3);
  }, DB_TIMEOUT_MS);

  test('FormSG rows go in 200 at a time, and a re-run skips every one', async () => {
    const db = await resetTestDb();
    const { values } = mapAll(
      Array.from({ length: 201 }, (_, i) => ({
        Timestamp: '2026-06-22 08:15:23',
        'Response ID': `resp-${i}`,
        RANK: 'REC',
        '[Myinfo] Name': 'Test Person',
        'Unit & Coy': '40 SAR / Archer',
        'Report Sick Type': 'RSI',
      })),
      mapFormSg,
    );
    expect(values).toHaveLength(201);

    expect(await insertNew(db, reportSickFormsg, values)).toBe(201);
    expect(await insertNew(db, reportSickFormsg, values)).toBe(0);
    expect(await countRows(db, 'report_sick_formsg')).toBe(201);
  }, DB_TIMEOUT_MS);
});
