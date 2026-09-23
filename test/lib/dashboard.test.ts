/**
 * The dashboard's read of Neon: each Neon value must come back as the cell the retired Sheet
 * held, because every number in `src/model/` is computed from those cells.
 *
 * The cell helpers are pure. `loadTabs` runs against the Neon test branch (`TEST_DATABASE_URL`),
 * filled through the app's own write paths -- the parade pipeline and the FormSG route -- and
 * each tab is checked against the dummy data that went in.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { handle as handleFormsg } from '../../api/formsg.ts';
import type { Db } from '../../db/index.ts';
import { commandRosterRows, publicHolidays, rotations } from '../../db/schema.ts';
import {
  loadTabs,
  personnelNumDays,
  personnelReason,
  platoonOf,
  rosterRole,
  sgtDateTime,
  toTab,
} from '../../lib/dashboard.ts';
import { ingestMessage } from '../../lib/pipeline.ts';
import {
  FORBIDDEN_HEADERS,
  FORBIDDEN_SUBMISSION_HEADERS,
  FORMSG_HEADERS,
  PERSONNEL_HEADERS,
  STRENGTH_HEADERS,
  TABS as SHEET_TABS,
} from '../../src/data/tabs.js';
import { DB_TIMEOUT_MS, hasTestDb, readOnlyTestDb, resetTestDb, TEST_DASHBOARD_DATABASE_URL } from '../support/db.ts';
import { FAKE_NRIC, FORM_KEYS, POST_URI, SICK_SPECS, sgtDay, testSdk, webhookRequest } from '../support/formsg.ts';
import { allEntries, companyTotals, expectedCounts, expectedKey, renderEntry, renderParadeState } from '../support/paradeState.ts';
import { SCENARIOS } from '../support/scenarios.ts';

const TABS = SHEET_TABS as Record<'STRENGTH' | 'PERSONNEL' | 'ROSTER' | 'FORMSG' | 'SUBMISSIONS' | 'HOLIDAYS' | 'ROTATIONS', string>;

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


describe.skipIf(!hasTestDb)('loadTabs, over a database filled through the app’s own write paths', () => {
  const SPECS = SCENARIOS.map(({ spec }) => spec);
  const HOLIDAY = { date: '2026-08-09', name: 'National Day' };
  const ROTATION = { name: 'R1', startDate: '2026-07-01', endDate: '2026-09-30' };
  let db: Db;
  let tabs: Awaited<ReturnType<typeof loadTabs>>;

  beforeAll(async () => {
    db = await resetTestDb();
    for (const [index, spec] of SPECS.entries()) {
      await ingestMessage(db, { waMessageId: `wa-${index}`, body: renderParadeState(spec) }, new Date(`${spec.date}T00:30:00Z`));
    }
    for (const spec of SICK_SPECS) {
      await handleFormsg(webhookRequest(spec), { db, secretKey: FORM_KEYS.secretKey, postUri: POST_URI, sdk: testSdk });
    }
    await db.insert(publicHolidays).values(HOLIDAY);
    await db.insert(rotations).values(ROTATION);
    tabs = await loadTabs(db);
  }, DB_TIMEOUT_MS * 3);

  /**
   * A tab's rows as records keyed by header.
   *
   * @param tab The tab name.
   * @returns The records.
   */
  function records(tab: string): Array<Record<string, unknown>> {
    const [header, ...rows] = tabs[tab] as [string[], ...unknown[][]];
    return rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index]])));
  }

  test('answers every tab the dashboard reads, under its own header rows', () => {
    expect(Object.keys(tabs).sort()).toEqual(Object.values(SHEET_TABS as Record<string, string>).sort());
    expect(tabs[TABS.STRENGTH]![0]).toEqual(STRENGTH_HEADERS);
    expect(tabs[TABS.PERSONNEL]![0]).toEqual(PERSONNEL_HEADERS);
    expect(tabs[TABS.FORMSG]![0]).toEqual(FORMSG_HEADERS);
  });

  test('Strength Data has one row per strength block, with the stated figures', () => {
    const rows = records(TABS.STRENGTH);
    expect(rows).toHaveLength(SPECS.reduce((sum, spec) => sum + expectedCounts(spec).strength, 0));
    for (const spec of SPECS) {
      const company = rows.find((row) => row.parade_response_id === expectedKey(spec) && row.unit_type === 'Company');
      const totals = companyTotals(spec);
      expect(company).toMatchObject({
        date: spec.date,
        company: spec.company,
        total_present: totals.total.present,
        officer_strength: totals.officer.strength,
        officer_present: totals.officer.present,
        wospec_present: totals.wospec.present,
        enlistee_present: totals.enlistee.present,
      });
    }
  });

  test('Personnel Data has one row per entry line, with platoons and the PERM sentinel', () => {
    const rows = records(TABS.PERSONNEL);
    const entries = SPECS.flatMap((spec) => allEntries(spec).map((entry) => ({ spec, entry })));
    expect(rows).toHaveLength(entries.length);
    expect(rows.map((row) => row.name).sort()).toEqual(entries.map(({ entry }) => entry.name).sort());
    for (const { spec, entry } of entries) {
      const row = rows.find((candidate) => candidate.parade_response_id === expectedKey(spec) && candidate.name === entry.name && candidate.reason_category === entry.section);
      expect(row!.platoon).toBe(entry.unit === 'HQ' ? 'HQ' : entry.unit.replace('PL ', ''));
      if (entry.perm) expect(row).toMatchObject({ num_days: 999, reason: expect.stringContaining('PERM') });
    }
  });

  test('Command Roster has every appointment, a PDS carrying its platoon', () => {
    const rows = records(TABS.ROSTER);
    expect(rows).toHaveLength(SPECS.reduce((sum, spec) => sum + spec.command.length, 0));
    expect(rows.map((row) => row.role)).toContain('PDS1');
    expect(rows.every((row) => row.vacant === false)).toBe(true);
  });

  test('the FormSG tab has each submission once, in Singapore time, with no NRIC', () => {
    const rows = records(TABS.FORMSG);
    expect(rows).toHaveLength(SICK_SPECS.length);
    for (const spec of SICK_SPECS) {
      const row = rows.find((candidate) => candidate['[Myinfo] Name'] === spec.name);
      expect(String(row!.Timestamp)).toStartWith(sgtDay(spec.created));
    }
    expect(JSON.stringify(tabs)).not.toContain(FAKE_NRIC);
  });

  test('the submissions tab lists each parade state once; holidays and rotations come through', () => {
    expect(records(TABS.SUBMISSIONS).map((row) => row.parade_response_id).sort()).toEqual(SPECS.map(expectedKey).sort());
    expect(records(TABS.HOLIDAYS)).toEqual([HOLIDAY]);
    expect(records(TABS.ROTATIONS)).toEqual([
      { name: ROTATION.name, start_date: ROTATION.startDate, end_date: ROTATION.endDate },
    ]);
  });

  test('no NRIC header, and no message text, can leave the database', () => {
    const headers = Object.values(tabs).flatMap((values) => values[0] as string[]);
    for (const forbidden of [...FORBIDDEN_HEADERS, ...FORBIDDEN_SUBMISSION_HEADERS]) expect(headers).not.toContain(forbidden);
    // A whole entry line appears only in the message body and `source_line`, neither of which is read.
    const line = renderEntry(SCENARIOS[1]!.spec.units[0]!.entries[0]!, 1);
    expect(JSON.stringify(tabs)).not.toContain(line);
  });
});

describe.skipIf(!hasTestDb)('a vacant appointment', () => {
  test('comes through marked vacant, not dropped', async () => {
    const db = await resetTestDb();
    const spec = SCENARIOS[1]!.spec;
    await ingestMessage(db, { waMessageId: 'wa-vacant', body: renderParadeState(spec) }, new Date(`${spec.date}T00:30:00Z`));
    await db.insert(commandRosterRows).values({ paradeResponseId: expectedKey(spec), roleKind: 'PDS', unitLabel: 'MED', isVacant: true });

    const tabs = await loadTabs(db);
    const [header, ...rows] = tabs[TABS.ROSTER] as [string[], ...unknown[][]];
    const vacant = rows.map((row) => Object.fromEntries(header.map((name, index) => [name, row[index]]))).filter((row) => row.vacant === true);
    expect(vacant).toEqual([expect.objectContaining({ role: 'PDSMED', name: '' })]);
  }, DB_TIMEOUT_MS);
});

describe.skipIf(!hasTestDb || !TEST_DASHBOARD_DATABASE_URL)('as the read-only dashboard_read role', () => {
  test('reads every tab, but can neither read a message body nor write', async () => {
    const owner = await resetTestDb();
    await ingestMessage(owner, { waMessageId: 'wa-1', body: renderParadeState(SCENARIOS[1]!.spec) }, new Date('2026-09-18T00:30:00Z'));
    const reader = readOnlyTestDb();

    const tabs = await loadTabs(reader);
    expect(tabs[TABS.PERSONNEL]!.length).toBeGreaterThan(1);
    await expect(reader.execute(sql`select body from raw_messages`)).rejects.toThrow();
    await expect(reader.execute(sql`delete from raw_messages`)).rejects.toThrow();
  }, DB_TIMEOUT_MS);
});
