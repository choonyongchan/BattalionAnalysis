/**
 * The dashboard's read of Neon. The helpers are pure; `loadDashboard` runs against the Neon test branch,
 * filled through the app's own write paths. NAMES ARE SYNTHETIC: no real name or 4D may appear here.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { handle as handleFormsg } from '../../../backend/api/reportsick.ts';
import { handle as handleSft } from '../../../backend/api/sft.ts';
import type { Db } from '../../../backend/db/index.ts';
import { commandRosterRows } from '../../../backend/db/schema.ts';
import {
  loadDashboard,
  personnelNumDays,
  personnelReason,
  platoonFromLabel,
  rosterRole,
  sgtDateTime,
} from '../../../backend/lib/dashboard.ts';
import { ingestMessage } from '../../../backend/lib/pipeline.ts';
import type { DashboardData } from '../../../shared/dashboard.ts';
import { sftDeps } from '../../support/app.ts';
import { DB_TIMEOUT_MS, hasTestDb, readOnlyTestDb, resetTestDb, TEST_DASHBOARD_DATABASE_URL } from '../../support/db.ts';
import {
  FAKE_NRIC,
  FORM_KEYS,
  POST_URI,
  SFT_SPECS,
  SICK_SPECS,
  sftWebhookRequest,
  sgtDay,
  testSdk,
  webhookRequest,
} from '../../support/formsg.ts';
import { allEntries, companyTotals, expectedCounts, expectedKey, renderEntry, renderParadeState } from '../../support/paradeState.ts';
import { SCENARIOS } from '../../support/scenarios.ts';

describe('platoonFromLabel', () => {
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
    expect(platoonFromLabel(label)).toBe(platoon);
  });
});

describe('rosterRole', () => {
  test('a company appointment is its own name', () => {
    expect(rosterRole('CDO', null)).toBe('CDO');
    expect(rosterRole('COS', '1')).toBe('COS');
  });

  test('a PDS carries its sub-unit with no space, as model/dutyRoster expects', () => {
    expect(rosterRole('PDS', '1')).toBe('PDS1');
    expect(rosterRole('PDS', ' 4 ')).toBe('PDS4');
    expect(rosterRole('PDS', 'SIG')).toBe('PDSSIG');
  });
});

describe('personnelReason', () => {
  const base = { dutyType: null, subReason: null, reportSickType: null, isPermanent: false };

  test('duty and detail combine into one reason', () => {
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

describe.skipIf(!hasTestDb)("loadDashboard, over a database filled through the app's own write paths", () => {
  const SPECS = SCENARIOS.map(({ spec }) => spec);
  let data: DashboardData;

  beforeAll(async () => {
    const db: Db = await resetTestDb();
    for (const [index, spec] of SPECS.entries()) {
      await ingestMessage(db, { waMessageId: `wa-${index}`, body: renderParadeState(spec) }, new Date(`${spec.date}T00:30:00Z`));
    }
    for (const spec of SICK_SPECS) {
      await handleFormsg(webhookRequest(spec), { db, secretKey: FORM_KEYS.secretKey, postUri: POST_URI, sdk: testSdk });
    }
    for (const spec of SFT_SPECS) {
      await handleSft(sftWebhookRequest(spec), sftDeps(db));
    }
    data = await loadDashboard(db);
  }, DB_TIMEOUT_MS * 3);

  test('answers every dataset the dashboard reads', () => {
    expect(Object.keys(data).sort()).toEqual(['formSg', 'personnel', 'roster', 'sectionCounts', 'sft', 'strength', 'submissions']);
  });

  test('sft has one row per session, as the webhook stored it', () => {
    expect(data.sft).toHaveLength(SFT_SPECS.length);
    SFT_SPECS.forEach((spec, index) => {
      expect(data.sft[index]).toEqual({
        timestamp: sgtDateTime(spec.created),
        date: sgtDay(spec.created),
        rank: spec.rank,
        name: spec.name,
        company: spec.company,
        groupIc: spec.groupIc,
        pesStatus: spec.pes,
        exercises: spec.exercises.join('; '),
        sfabtType: spec.sfabt,
        location: spec.location,
      });
    });
  });

  test('sectionCounts states, for each section, the number of names the section lists', () => {
    const key = (row: { paradeResponseId: string; platoon: string; reasonCategory: string }) =>
      [row.paradeResponseId, row.platoon, row.reasonCategory].join('|');
    const listed = new Map<string, number>();
    for (const row of data.personnel) listed.set(key(row), (listed.get(key(row)) ?? 0) + 1);
    expect(data.sectionCounts.length).toBeGreaterThan(0);
    for (const row of data.sectionCounts) expect(row.statedCount).toBe(listed.get(key(row)) ?? 0);
  });

  test('strength has one row per strength block, with the stated figures', () => {
    expect(data.strength).toHaveLength(SPECS.reduce((sum, spec) => sum + expectedCounts(spec).strength, 0));
    for (const spec of SPECS) {
      const company = data.strength.find((row) => row.paradeResponseId === expectedKey(spec) && row.unitType === 'Company');
      const totals = companyTotals(spec);
      expect(company).toMatchObject({
        date: spec.date,
        company: spec.company,
        totalPresent: totals.total.present,
        officerStrength: totals.officer.strength,
        officerPresent: totals.officer.present,
        wospecPresent: totals.wospec.present,
        enlisteePresent: totals.enlistee.present,
      });
    }
  });

  test('personnel has one row per entry line, with platoons and the PERM sentinel', () => {
    const entries = SPECS.flatMap((spec) => allEntries(spec).map((entry) => ({ spec, entry })));
    expect(data.personnel).toHaveLength(entries.length);
    expect(data.personnel.map((row) => row.name).sort()).toEqual(entries.map(({ entry }) => entry.name).sort());
    for (const { spec, entry } of entries) {
      const row = data.personnel.find(
        (candidate) =>
          candidate.paradeResponseId === expectedKey(spec) && candidate.name === entry.name && candidate.reasonCategory === entry.section,
      );
      expect(row!.platoon).toBe(entry.unit === 'HQ' ? 'HQ' : entry.unit.replace('PL ', ''));
      if (entry.perm) expect(row).toMatchObject({ numDays: 999, reason: expect.stringContaining('PERM') });
    }
  });

  test('roster has every appointment, a PDS carrying its platoon', () => {
    expect(data.roster).toHaveLength(SPECS.reduce((sum, spec) => sum + spec.command.length, 0));
    expect(data.roster.map((row) => row.role)).toContain('PDS1');
    expect(data.roster.every((row) => row.vacant === false)).toBe(true);
  });

  test('formSg has each submission once, in Singapore time, with its company and no NRIC', () => {
    expect(data.formSg).toHaveLength(SICK_SPECS.length);
    for (const spec of SICK_SPECS) {
      const row = data.formSg.find((candidate) => candidate.name === spec.name);
      expect(row!.timestamp).toStartWith(sgtDay(spec.created));
      expect(row!.company).not.toBeNull();
    }
    expect(JSON.stringify(data)).not.toContain(FAKE_NRIC);
  });

  test('submissions lists each parade state once', () => {
    expect(data.submissions.map((row) => row.paradeResponseId).sort()).toEqual(SPECS.map(expectedKey).sort());
  });

  test('no NRIC field, and no message text, can leave the database', () => {
    const fields = Object.values(data).flatMap((rows: object[]) => rows.flatMap((row) => Object.keys(row)));
    expect(fields.filter((field) => /nric|body|message/i.test(field))).toEqual([]);
    // A whole entry line appears only in the message body and `source_line`, neither of which is read.
    const line = renderEntry(SCENARIOS[1]!.spec.units[0]!.entries[0]!, 1);
    expect(JSON.stringify(data)).not.toContain(line);
  });
});

describe.skipIf(!hasTestDb)('a vacant appointment', () => {
  test('comes through marked vacant, not dropped', async () => {
    const db = await resetTestDb();
    const spec = SCENARIOS[1]!.spec;
    await ingestMessage(db, { waMessageId: 'wa-vacant', body: renderParadeState(spec) }, new Date(`${spec.date}T00:30:00Z`));
    await db.insert(commandRosterRows).values({ paradeResponseId: expectedKey(spec), roleKind: 'PDS', unitLabel: 'MED', isVacant: true });

    const { roster } = await loadDashboard(db);
    expect(roster.filter((row) => row.vacant)).toEqual([expect.objectContaining({ role: 'PDSMED', name: null })]);
  }, DB_TIMEOUT_MS);
});

describe.skipIf(!hasTestDb || !TEST_DASHBOARD_DATABASE_URL)('as the read-only dashboard_read role', () => {
  test('reads every dataset, but can neither read a message body nor write', async () => {
    const owner = await resetTestDb();
    await ingestMessage(owner, { waMessageId: 'wa-1', body: renderParadeState(SCENARIOS[1]!.spec) }, new Date('2026-09-18T00:30:00Z'));
    const reader = readOnlyTestDb();

    expect((await loadDashboard(reader)).personnel.length).toBeGreaterThan(0);
    await expect(reader.execute(sql`select body from raw_messages`)).rejects.toThrow();
    await expect(reader.execute(sql`delete from raw_messages`)).rejects.toThrow();
  }, DB_TIMEOUT_MS);
});
