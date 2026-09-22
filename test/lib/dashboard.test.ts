/**
 * The dashboard's read of Neon: each Neon value must come back as the cell the retired Sheet
 * held, because every number in `src/model/` is computed from those cells.
 */
import { describe, expect, test } from 'bun:test';
import type { Db } from '../../db/index.ts';
import {
  commandRosterRows,
  paradeSubmissions,
  personnelRows,
  publicHolidays,
  reportSickFormsg,
  rotations,
  strengthRows,
} from '../../db/schema.ts';
import {
  loadTabs,
  personnelNumDays,
  personnelReason,
  platoonOf,
  rosterRole,
  sgtDateTime,
  toTab,
} from '../../lib/dashboard.ts';
import {
  FORBIDDEN_HEADERS,
  FORBIDDEN_SUBMISSION_HEADERS,
  FORMSG_HEADERS,
  PERSONNEL_HEADERS,
  STRENGTH_HEADERS,
  TABS as SHEET_TABS,
} from '../../src/data/tabs.js';

const TABS = SHEET_TABS as Record<'STRENGTH' | 'PERSONNEL' | 'ROSTER' | 'FORMSG' | 'SUBMISSIONS', string>;

describe('platoonOf', () => {
  test.each([
    ['PLATOON 1', '1'],
    ['PL2', '2'],
    ['PLT 3', '3'],
    ['3', '3'],
    ['COY HQ', 'HQ'],
    ['HQ', 'HQ'],
    ['Company', ''],
    ['', ''],
    [null, ''],
    ['SIG', 'SIG'],
  ])('%p reads as %p', (label, platoon) => {
    expect(platoonOf(label)).toBe(platoon);
  });
});

describe('rosterRole', () => {
  test('a company appointment is its own name', () => {
    expect(rosterRole('CDO', null)).toBe('CDO');
    expect(rosterRole('COS', '1')).toBe('COS');
  });

  test('a PDS carries its sub-unit with no space, as model/orbat.js expects', () => {
    expect(rosterRole('PDS', '1')).toBe('PDS1');
    expect(rosterRole('PDS', ' 4 ')).toBe('PDS4');
    expect(rosterRole('PDS', 'SIG')).toBe('PDSSIG');
  });
});

describe('personnelReason', () => {
  const base = { dutyType: null, subReason: null, reportSickType: null, isPermanent: false };

  test('duty and detail combine as the Sheet wrote them', () => {
    expect(personnelReason({ ...base, dutyType: 'MC' })).toBe('MC');
    expect(personnelReason({ ...base, dutyType: 'EXCUSE', subReason: 'HEAVY LOADS' })).toBe('EXCUSE (HEAVY LOADS)');
    expect(personnelReason({ ...base, subReason: 'INJURED ARM' })).toBe('INJURED ARM');
  });

  test('a report-sick line with no duty word reads as its type', () => {
    expect(personnelReason({ ...base, reportSickType: 'RSI' })).toBe('RSI');
  });

  test('a permanent status keeps the word the model recognises, once', () => {
    expect(personnelReason({ ...base, dutyType: 'EXCUSE', subReason: 'KNEELING', isPermanent: true })).toBe(
      'PERM EXCUSE (KNEELING)',
    );
    expect(personnelReason({ ...base, dutyType: 'Permanent Excuse (Grenades)', isPermanent: true })).toBe(
      'Permanent Excuse (Grenades)',
    );
  });
});

describe('personnelNumDays', () => {
  test('a permanent status carries the 999 sentinel; anything else its stated count', () => {
    expect(personnelNumDays({ numDays: null, isPermanent: true, reasonCategory: 'Status' })).toBe(999);
    expect(personnelNumDays({ numDays: 5, isPermanent: false, reasonCategory: 'Status' })).toBe(5);
    expect(personnelNumDays({ numDays: null, isPermanent: true, reasonCategory: 'Others' })).toBeNull();
  });
});

describe('sgtDateTime', () => {
  test('renders the driver timestamp as Singapore wall time', () => {
    expect(sgtDateTime('2026-09-18 00:15:23.5+00')).toBe('2026-09-18T08:15:23');
    expect(sgtDateTime('2026-09-17T20:00:00Z')).toBe('2026-09-18T04:00:00');
  });

  test('blank or unreadable is blank', () => {
    expect(sgtDateTime(null)).toBe('');
    expect(sgtDateTime('not a time')).toBe('');
  });
});

describe('toTab', () => {
  test('lays records out under the header row, blanks for missing cells', () => {
    expect(toTab(['a', 'b'], [{ a: 1 }, { a: null, b: 'x' }])).toEqual([
      ['a', 'b'],
      [1, ''],
      ['', 'x'],
    ]);
  });
});

/**
 * A stand-in for the Drizzle handle: every chain resolves to the rows for its `from` table.
 *
 * @param rows Rows per table.
 * @returns The fake handle.
 */
function fakeDb(rows: Map<unknown, unknown[]>): Db {
  const chain = (table: unknown): any => {
    const self: any = {
      innerJoin: () => self,
      leftJoin: () => self,
      where: () => self,
      orderBy: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(rows.get(table) ?? []).then(resolve, reject),
    };
    return self;
  };
  return { select: () => ({ from: chain }) } as unknown as Db;
}

describe('loadTabs', () => {
  const SUBMISSION = { id: 'Archer_2026-09-18_FPS', date: '2026-09-18', session: 'FPS', company: 'Archer' };
  const db = fakeDb(
    new Map<unknown, unknown[]>([
      [strengthRows, [{ ...SUBMISSION, unitLabel: 'PLATOON 2', unitType: 'PLATOON', totalStrength: 30, totalPresent: 28 }]],
      [
        personnelRows,
        [
          {
            ...SUBMISSION,
            unitLabel: 'COY HQ',
            fourD: '2105',
            name: 'TEST PERSON',
            rank: 'REC',
            reasonCategory: 'Status',
            startDate: '2026-09-01',
            endDate: null,
            numDays: null,
            isPermanent: true,
            dutyType: 'EXCUSE',
            subReason: 'RMJ',
            reportSickType: null,
            location: null,
          },
        ],
      ],
      [commandRosterRows, [{ ...SUBMISSION, roleKind: 'PDS', unitLabel: '2', rank: '3SG', name: 'TEST PDS' }]],
      [reportSickFormsg, [{ timestamp: '2026-09-18 00:15:23+00', rank: 'REC', name: 'TEST PERSON', fourD: '2105', unitCoy: 'Archer', reportSickType: 'RSI', reason: 'fever', symptoms: 'Fever' }]],
      [paradeSubmissions, [{ id: SUBMISSION.id, filedAt: '2026-09-17 23:30:00+00' }]],
      [publicHolidays, [{ date: '2026-08-09', name: 'National Day' }]],
      [rotations, [{ name: 'R1', start_date: '2026-07-01', end_date: '2026-09-30' }]],
    ]),
  );

  test('answers every tab the dashboard reads, under its own header rows', async () => {
    const tabs = await loadTabs(db);
    expect(Object.keys(tabs).sort()).toEqual(Object.values(SHEET_TABS as Record<string, string>).sort());
    expect(tabs[TABS.STRENGTH]![0]).toEqual(STRENGTH_HEADERS);
    expect(tabs[TABS.PERSONNEL]![0]).toEqual(PERSONNEL_HEADERS);
    expect(tabs[TABS.FORMSG]![0]).toEqual(FORMSG_HEADERS);
  });

  test('shapes each value as the Sheet cell it replaces', async () => {
    const tabs = await loadTabs(db);
    const record = (tab: string) => {
      const [header, row] = tabs[tab] as [string[], unknown[]];
      return Object.fromEntries(header.map((name, i) => [name, row[i]]));
    };
    expect(record(TABS.STRENGTH)).toMatchObject({ platoon: '2', unit_type: 'PLATOON', total_present: 28 });
    expect(record(TABS.PERSONNEL)).toMatchObject({ platoon: 'HQ', num_days: 999, reason: 'PERM EXCUSE (RMJ)', end_date: '' });
    expect(record(TABS.ROSTER)).toMatchObject({ role: 'PDS2', name: 'TEST PDS' });
    expect(record(TABS.FORMSG)).toMatchObject({ Timestamp: '2026-09-18T08:15:23', 'Unit & Coy': 'Archer' });
    expect(record(TABS.SUBMISSIONS)).toEqual({ Timestamp: '2026-09-18T07:30:00', parade_response_id: SUBMISSION.id });
  });

  test('no NRIC or message-body header can leave the database', async () => {
    const headers = Object.values(await loadTabs(db)).flatMap((values) => values[0] as string[]);
    for (const forbidden of [...FORBIDDEN_HEADERS, ...FORBIDDEN_SUBMISSION_HEADERS]) {
      expect(headers).not.toContain(forbidden);
    }
  });
});
