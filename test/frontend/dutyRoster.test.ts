/** Tests for the duty roster: a company that files no roster must show as such, never be omitted. */

import { describe, expect, test } from 'bun:test';
import type { RosterRow } from '../../shared/dashboard.ts';
import { personnelRows, rosterRow, rosterRows } from './fixtures.ts';
import type { Company } from '../../shared/domain.ts';
import { dutyRosterCoverage, dutyRosterTree, rosterOn, vacanciesOn, rosterClashes, rosterLoad } from '../../frontend/src/model/dutyRoster.ts';

describe('rosterOn', () => {
  test('a fully filed company returns all six non-HQ roles, filed', () => {
    const rows = rosterRows(
      ['CDO', 'CDS', 'COS', 'PDSHQ', 'PDS1', 'PDS2', 'PDS3'].map((role) => ({
        paradeResponseId: 'Archer_2026-07-22_FPS',
        date: '2026-07-22',
        session: 'FPS',
        company: 'Archer',
        role,
        rank: '3SG',
        name: role + '_NAME',
      }))
    );
    const roster = rosterOn(rows, '2026-07-22', 'Archer', 'FPS');
    expect(roster).toHaveLength(6);
    expect(roster.every((entry) => entry.filed)).toBe(true);
  });

  test('a company filing only COS shows the other five roles as not filed', () => {
    const rows = rosterRows([
      { paradeResponseId: 'Hercules_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Hercules', role: 'COS', rank: 'PTE', name: 'LEROY' },
    ]);
    const roster = rosterOn(rows, '2026-07-22', 'Hercules', 'FPS');
    expect(roster.find((entry) => entry.role === 'COS')!.filed).toBe(true);
    expect(roster.filter((entry) => entry.filed)).toHaveLength(1);
    expect(roster.find((entry) => entry.role === 'CDO')!.filed).toBe(false);
  });

  test('a company filing nothing returns every role unfilled', () => {
    const roster = rosterOn(rosterRows([]), '2026-07-22', 'Braves', 'FPS');
    expect(roster.every((entry) => !entry.filed)).toBe(true);
  });

  test('a duplicate submission resolves to the later paradeResponseId', () => {
    const rows = rosterRows([
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'CDO', rank: '2LT', name: 'FIRST' },
      { paradeResponseId: 'Archer_2026-07-22_FPS_2', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'CDO', rank: '2LT', name: 'SECOND' },
    ]);
    const roster = rosterOn(rows, '2026-07-22', 'Archer', 'FPS');
    expect(roster.find((entry) => entry.role === 'CDO')!.name).toBe('SECOND');
  });

  test('an unknown role in the data is ignored rather than crashing', () => {
    const rows = rosterRows([
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'QUARTERMASTER', rank: 'CPL', name: 'X' },
    ]);
    expect(() => rosterOn(rows, '2026-07-22', 'Archer', 'FPS')).not.toThrow();
    expect(rosterOn(rows, '2026-07-22', 'Archer', 'FPS').every((entry) => !entry.filed)).toBe(true);
  });
});

describe('dutyRosterTree', () => {
  test('COS sits beside CDS, supporting it, rather than under the PDS platoons', () => {
    const rows = rosterRows([
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'CDS', rank: '3SG', name: 'CDS_NAME' },
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'COS', rank: 'PTE', name: 'COS_NAME' },
    ]);
    const tree = dutyRosterTree(rows, '2026-07-22', { company: 'Archer' });
    const cds = tree.children[0]!.children[0]!;
    expect(cds.role).toBe('CDS');
    expect(cds.children.map((child) => child.role)).toEqual(['COS', 'PDS1', 'PDS2', 'PDS3']);
  });

  test("each company's PDS slots follow its own platoon numbering", () => {
    const tree = dutyRosterTree(rosterRows([]), '2026-07-22');
    const pdsOf = (name: Company) => {
      const node = dutyRosterTree(
        rosterRows([{ paradeResponseId: name + '_1', date: '2026-07-22', session: 'FPS', company: name, role: 'CDO', rank: 'CPT', name: 'X' }]),
        '2026-07-22',
        { company: name }
      );
      return node.children[0]!.children[0]!.children.map((child) => child.role).slice(1);
    };
    expect(tree.children).toHaveLength(5);
    expect(pdsOf('Archer')).toEqual(['PDS1', 'PDS2', 'PDS3']);
    expect(pdsOf('Braves')).toEqual(['PDS4', 'PDS5', 'PDS6']);
    expect(pdsOf('Cougar')).toEqual(['PDS7', 'PDS8', 'PDS9']);
    expect(pdsOf('Stallion')).toEqual(['PDSPNR', 'PDSMTR', 'PDSSCR', 'PDSSIG']);
    expect(pdsOf('Hercules')).toEqual(['PDSSIG', 'PDSOPR+ASA', 'PDSMED']);
  });

  test('a Cougar PDS 8 lands in its slot and Coy HQ is excluded', () => {
    const base: Partial<RosterRow> = { paradeResponseId: 'Cougar_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Cougar' };
    const roster = rosterOn(
      rosterRows([
        { ...base, role: 'PDS8', rank: '3SG', name: 'EIGHT' },
      ]),
      '2026-07-22',
      'Cougar'
    );
    expect(roster.find((entry) => entry.role === 'PDS8')).toMatchObject({ filed: true, name: 'EIGHT' });
    expect(roster.find((entry) => entry.role === 'PDSHQ')).toBeUndefined();
  });

  test('the battalion tree contains all five companies, including ones that filed nothing', () => {
    const rows = rosterRows([
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'CDO', rank: '2LT', name: 'X' },
    ]);
    const tree = dutyRosterTree(rows, '2026-07-22');
    expect(tree.children.map((child) => child.name)).toEqual([
      'Archer', 'Braves', 'Cougar', 'Stallion', 'Hercules',
    ]);
    const braves = tree.children.find((child) => child.name === 'Braves')!;
    expect(braves.filed).toBe(false);
    expect(braves.children[0]!.name).toBe('No roster filed');
  });
});

describe('dutyRosterCoverage', () => {
  test('counts filed companies and roles per company', () => {
    const rows = rosterRows([
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'CDO', rank: '2LT', name: 'X' },
      { paradeResponseId: 'Archer_2026-07-22_FPS', date: '2026-07-22', session: 'FPS', company: 'Archer', role: 'CDS', rank: '3SG', name: 'Y' },
    ]);
    const coverage = dutyRosterCoverage(rows, '2026-07-22', 'FPS');
    expect(coverage.filedCount).toBe(1);
    expect(coverage.companies.find((c) => c.company === 'Archer')!.roles).toBe(2);
    expect(coverage.companies.find((c) => c.company === 'Braves')!.filed).toBe(false);
  });
});

describe('vacant appointments', () => {
  const base: Partial<RosterRow> = { paradeResponseId: 'Hercules_2026-09-22_FPS', date: '2026-09-22', session: 'FPS', company: 'Hercules' };

  test('a role filed as vacant is filed, vacant, and reads Vacant in the tree', () => {
    const rows = rosterRows([
      { ...base, role: 'CDO', rank: 'CPT', name: 'TAN' },
      { ...base, role: 'PDSMED', vacant: true },
    ]);
    const roster = rosterOn(rows, '2026-09-22', 'Hercules');
    expect(roster.find((entry) => entry.role === 'PDSMED')).toMatchObject({ filed: true, vacant: true });
    expect(roster.find((entry) => entry.role === 'CDO')!.vacant).toBe(false);

    const tree = dutyRosterTree(rows, '2026-09-22', { company: 'Hercules' });
    const cds = tree.children[0]!.children[0]!;
    expect(cds.children.find((node) => node.role === 'PDSMED')!.name).toBe('Vacant');
  });

  test('vacanciesOn lists every vacant chair, a named sub-unit included, from the latest submission', () => {
    const rows = rosterRows([
      { ...base, paradeResponseId: 'Hercules_2026-09-22_FPS_2', role: 'PDSMED', vacant: true },
      { ...base, paradeResponseId: 'Hercules_2026-09-22_FPS_2', role: 'PDS1', vacant: false, rank: '3SG', name: 'LIM' },
      { ...base, paradeResponseId: 'Hercules_2026-09-22_FPS_1', role: 'PDS2', vacant: true },
    ]);
    expect(vacanciesOn(rows, '2026-09-22')).toEqual([{ company: 'Hercules', role: 'PDSMED' }]);
    expect(vacanciesOn(rows, '2026-09-23')).toEqual([]);
  });
});

describe('rosterLoad and rosterClashes', () => {
  const duty = (date: string, company: Company, role: string, name: string) =>
    rosterRow({ date, company, role, rank: 'CPT', name, paradeResponseId: date + company });
  const roster = [
    duty('2026-10-03', 'Archer', 'CDO', 'ALPHA TAN'), // Saturday
    duty('2026-10-03', 'Braves', 'CDO', 'ALPHA TAN'), // same battalion CDO, one duty
    duty('2026-10-05', 'Archer', 'PDS1', 'BRAVO LIM'),
    duty('2026-10-06', 'Archer', 'COS', 'ALPHA TAN'),
  ];

  test('counts each person once per date and appointment, weekends apart', () => {
    expect(rosterLoad(roster)).toEqual([
      { name: 'ALPHA TAN', rank: 'CPT', duties: 2, weekend: 1 },
      { name: 'BRAVO LIM', rank: 'CPT', duties: 1, weekend: 0 },
    ]);
  });

  test('lists a duty filed for someone the same parade lists on MC or leave', () => {
    const personnel = personnelRows([
      { date: '2026-10-05', company: 'Archer', name: 'LIM BRAVO', reasonCategory: 'Att C', reason: 'MC (Fever)' },
      { date: '2026-10-06', company: 'Archer', name: 'ALPHA TAN', reasonCategory: 'Status', reason: 'LD' },
      { date: '2026-10-03', company: 'Archer', rank: 'LCP', name: 'ALPHA TAN', reasonCategory: 'Att C', reason: 'MC' },
    ]);
    expect(rosterClashes(roster, personnel)).toEqual([
      { date: '2026-10-05', appointment: 'PDS', rank: 'CPT', name: 'BRAVO LIM', company: 'Archer', away: 'MC (Fever)' },
    ]);
  });
});
