/**
 * The duty tree for a parade: CDO over CDS, COS supporting CDS, a PDS per sub-unit under CDS.
 * Coverage is poor (Braves never files), so a company that filed nothing is one leaf saying so:
 * that absence is the finding. A company filing twice: the later `paradeResponseId` wins.
 */

import { COMMAND_ROLES, COMPANIES, commandRolesOf } from '../../../shared/domain.ts';
import type { PersonnelRow, RosterRow } from '../../../shared/dashboard.ts';
import { isWeekend } from '../../../shared/dates.ts';
import { namesMatch, normaliseName } from '../../../shared/identity.ts';
import { toText } from '../../../shared/values.ts';
import { settingOf } from './activeSettings.ts';
import { classify, DUTY_CLASS, type DutyClass } from './classify.ts';

/** Duty classes that mean the soldier was away that day. */
const AWAY = new Set<DutyClass>([DUTY_CLASS.ATT_C, DUTY_CLASS.OFF_LEAVE]);

/** One role on a company's roster; a role filed as `-` is filed and vacant. */
export interface RosterEntry {
  role: string;
  rank: string;
  name: string;
  filed: boolean;
  vacant: boolean;
}

/** A node of the duty tree. */
export interface TreeNode {
  name: string;
  role: string;
  rank?: string;
  filed: boolean;
  vacant?: boolean;
  children: TreeNode[];
}

/** A role as `commandRolesOf` lists it, so `PDS COY HQ` and `PDS HQ` meet. */
function canonicalRole(role: string): string {
  const text = role.toUpperCase().replace(/\s+/g, '');
  return text === 'PDSCOYHQ' ? 'PDSHQ' : text;
}

/** One company's roster rows for a parade, from its latest submission only. */
function latestRosterRows(rows: RosterRow[], isoDate: string, company: string, session: string): RosterRow[] {
  const matching = rows.filter((row) => row.date === isoDate && row.company === company && row.session === session);
  const latestId = matching.map((row) => row.paradeResponseId).sort().pop();
  return matching.filter((row) => row.paradeResponseId === latestId);
}

/** One company's roster for a parade, every role listed in order whether filed or not. */
export function rosterOn(rows: RosterRow[], isoDate: string, company: string, session = 'FPS'): RosterEntry[] {
  const roles = commandRolesOf(company);
  const byRole = new Map<string, RosterEntry>();
  for (const row of latestRosterRows(rows, isoDate, company, session)) {
    const role = canonicalRole(row.role);
    if (roles.includes(role)) byRole.set(role, { role, rank: toText(row.rank), name: toText(row.name), filed: true, vacant: row.vacant });
  }
  return roles.map((role) => byRole.get(role) ?? { role, rank: '', name: '', filed: false, vacant: false });
}

/** Every appointment filed vacant on a parade, battalion-wide, including sub-units the tree does not list. */
export function vacanciesOn(rows: RosterRow[], isoDate: string, session = 'FPS'): { company: string; role: string }[] {
  return COMPANIES.flatMap((company) =>
    latestRosterRows(rows, isoDate, company, session)
      .filter((row) => row.vacant)
      .map((row) => ({ company, role: canonicalRole(row.role) })),
  );
}

/** The tree node for a role. */
function roleNode(entry: RosterEntry, children: TreeNode[] = []): TreeNode {
  const name = entry.vacant ? 'Vacant' : entry.filed ? `${entry.rank} ${entry.name}` : 'Not filed';
  return { name, role: entry.role, rank: entry.rank, filed: entry.filed, vacant: entry.vacant, children };
}

/** One company's tree, rooted at CDO. */
function companyTree(rows: RosterRow[], isoDate: string, company: string, session: string): TreeNode {
  const roster = rosterOn(rows, isoDate, company, session);
  const role = (name: string) => roster.find((entry) => entry.role === name)!;
  const platoons = roster.filter((entry) => !COMMAND_ROLES.includes(entry.role)).map((entry) => roleNode(entry));
  const cds = roleNode(role('CDS'), [roleNode(role('COS')), ...platoons]);
  return { name: company, role: 'COMPANY', filed: roster.some((entry) => entry.filed), children: [roleNode(role('CDO'), [cds])] };
}

/** The duty tree for one company, or for the battalion with every company (one that filed nothing is a single leaf). */
export function dutyRosterTree(rows: RosterRow[], isoDate: string, { company, session = 'FPS' }: { company?: string; session?: string } = {}): TreeNode {
  if (company) return companyTree(rows, isoDate, company, session);
  return {
    name: settingOf('unit').name,
    role: 'BATTALION',
    filed: true,
    children: COMPANIES.map((name) => {
      const tree = companyTree(rows, isoDate, name, session);
      if (tree.filed) return tree;
      return { name, role: 'COMPANY', filed: false, children: [{ name: 'No roster filed', role: 'NONE', filed: false, children: [] }] };
    }),
  };
}

/** Which companies filed a roster on a date, how many roles each, and how many filed anything. */
export function dutyRosterCoverage(
  rows: RosterRow[],
  isoDate: string,
  session = 'FPS',
): { companies: { company: string; filed: boolean; roles: number }[]; filedCount: number } {
  const companies = COMPANIES.map((company) => {
    const roles = rosterOn(rows, isoDate, company, session).filter((entry) => entry.filed).length;
    return { company, filed: roles > 0, roles };
  });
  return { companies, filedCount: companies.filter((entry) => entry.filed).length };
}

/** One filled duty. */
export interface Duty {
  date: string;
  /** `CDO`, `CDS`, `COS` or `PDS`. */
  appointment: string;
  rank: string;
  name: string;
  company: string;
}

/** Every filled duty once: a battalion CDO on all five rosters is one duty, not five. */
function duties(rows: RosterRow[], session: string): Duty[] {
  const seen = new Map<string, Duty>();
  for (const row of rows) {
    if (row.session !== session || !toText(row.name) || row.vacant) continue;
    const role = canonicalRole(row.role);
    const appointment = COMMAND_ROLES.includes(role) ? role : 'PDS';
    const key = `${row.date}|${appointment}|${normaliseName(row.name)}`;
    if (!seen.has(key)) seen.set(key, { date: row.date, appointment, rank: toText(row.rank), name: toText(row.name), company: row.company });
  }
  return Array.from(seen.values());
}

/** Duties per person and how many fell on a weekend, most duties first. */
export function rosterLoad(rows: RosterRow[], session = 'FPS'): { name: string; rank: string; duties: number; weekend: number }[] {
  const byPerson = new Map<string, { name: string; rank: string; duties: number; weekend: number }>();
  for (const duty of duties(rows, session)) {
    const key = normaliseName(duty.name);
    const entry = byPerson.get(key) ?? { name: duty.name, rank: duty.rank, duties: 0, weekend: 0 };
    entry.duties += 1;
    if (isWeekend(duty.date)) entry.weekend += 1;
    byPerson.set(key, entry);
  }
  return Array.from(byPerson.values()).sort((a, b) => b.duties - a.duties || a.name.localeCompare(b.name));
}

/**
 * Duties filed for someone that day's parade state lists on MC or leave, newest first. Names match
 * loosely, so a stated rank must agree too (`1WO BRAVO LIM` is not `LCP BRAVO LIM`).
 */
export function rosterClashes(rows: RosterRow[], personnelRows: PersonnelRow[], session = 'FPS'): (Duty & { away: string })[] {
  const away = personnelRows.filter((row) => row.session === session && AWAY.has(classify(row)));
  const clashes: (Duty & { away: string })[] = [];
  for (const duty of duties(rows, session)) {
    const sameRank = (row: PersonnelRow) => !toText(row.rank) || !duty.rank || toText(row.rank).toUpperCase() === duty.rank.toUpperCase();
    const match = away.find((row) => row.date === duty.date && namesMatch(row.name, duty.name) && sameRank(row));
    if (match) clashes.push({ ...duty, away: toText(match.reason) || match.reasonCategory });
  }
  return clashes.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
}
