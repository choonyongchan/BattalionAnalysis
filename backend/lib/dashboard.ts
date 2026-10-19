/**
 * The dashboard's read of Neon: one typed array per dataset (`shared/dashboard.ts`).
 * Only the selected columns leave the database; the `dashboard_read` role cannot read a message body.
 */
import { asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import {
  commandRosterRows,
  paradeSubmissions,
  personnelRows,
  rawMessages,
  reportSickFormsg,
  sectionCounts,
  sftFormsg,
  strengthRows,
} from '../db/schema.ts';
import { SGT_OFFSET_MS } from '../../shared/dates.ts';
import { HQ_LABEL, PERM_STATUS_NUM_DAYS, PLATOON_LABEL, companyFromUnitCoy } from '../../shared/domain.ts';
import { cleanText } from '../../shared/identity.ts';
import type {
  DashboardData,
  FilingRow,
  PersonnelRow,
  ReportSickRow,
  RosterRow,
  SectionCountRow,
  SftSessionRow,
  StrengthRow,
} from '../../shared/dashboard.ts';

/** `parade_submissions.model` of a Sheet-imported submission with no filing time; left out of filing times. */
const UNTIMED_MODEL = 'sheet:untimed';

/** A block label as the dashboard's platoon: `PL 2` is `2`, `COY HQ` is `HQ`, the roll-up is '', a named sub-unit as written. */
export function platoonFromLabel(unitLabel: string | null | undefined): string {
  const label = cleanText(unitLabel ?? '').toUpperCase().trim();
  if (label === '' || label === 'COMPANY') return '';
  if (HQ_LABEL.test(label)) return 'HQ';
  if (PLATOON_LABEL.test(label) || /^\d+$/.test(label)) return label.replace(/\D/g, '');
  return label;
}

/** A roster role: `CDO`, `CDS`, `COS`, or `PDS` + sub-unit with no space (`PDS7`, `PDSSIG`). */
export function rosterRole(roleKind: string, unitLabel: string | null | undefined): string {
  if (roleKind !== 'PDS') return roleKind;
  return 'PDS' + cleanText(unitLabel ?? '').toUpperCase().replace(/\s+/g, '');
}

/** One reason text from the parsed parts, e.g. `PERM EXCUSE (KNEELING)`; the model spots permanence by `PERM`. */
export function personnelReason(row: {
  dutyType: string | null;
  subReason: string | null;
  reportSickType: string | null;
  isPermanent: boolean;
}): string {
  const duty = row.dutyType || row.reportSickType || '';
  let text = row.subReason ? (duty ? `${duty} (${row.subReason})` : row.subReason) : duty;
  if (row.isPermanent && !/\bperm/i.test(text)) text = `PERM ${text}`.trim();
  return text;
}

/** The stated day count, or the permanent-status sentinel. */
export function personnelNumDays(row: { numDays: number | null; isPermanent: boolean; reasonCategory: string }): number | null {
  return row.isPermanent && row.reasonCategory === 'Status' ? PERM_STATUS_NUM_DAYS : row.numDays;
}

/** A driver timestamp (`2026-09-18 00:15:23.5+00`) as Singapore-local `yyyy-MM-ddTHH:mm:ss`, or ''. */
export function sgtDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms + SGT_OFFSET_MS).toISOString().slice(0, 19);
}

/** Every strength block of every parade state. */
async function strength(db: Db): Promise<StrengthRow[]> {
  const rows = await db
    .select({
      paradeResponseId: paradeSubmissions.paradeResponseId,
      date: paradeSubmissions.date,
      session: paradeSubmissions.session,
      company: paradeSubmissions.company,
      unitLabel: strengthRows.unitLabel,
      unitType: strengthRows.unitType,
      totalStrength: strengthRows.totalStrength,
      totalPresent: strengthRows.totalPresent,
      officerStrength: strengthRows.officerStrength,
      officerPresent: strengthRows.officerPresent,
      wospecStrength: strengthRows.wospecStrength,
      wospecPresent: strengthRows.wospecPresent,
      enlisteeStrength: strengthRows.enlisteeStrength,
      enlisteePresent: strengthRows.enlisteePresent,
    })
    .from(strengthRows)
    .innerJoin(paradeSubmissions, eq(strengthRows.paradeResponseId, paradeSubmissions.paradeResponseId))
    .orderBy(asc(paradeSubmissions.date), asc(strengthRows.id));
  return rows.map(({ unitLabel, ...row }) => ({ ...row, platoon: platoonFromLabel(unitLabel) }));
}

/** Every person listed in every parade state. */
async function personnel(db: Db): Promise<PersonnelRow[]> {
  const rows = await db
    .select({
      paradeResponseId: paradeSubmissions.paradeResponseId,
      date: paradeSubmissions.date,
      session: paradeSubmissions.session,
      company: paradeSubmissions.company,
      unitLabel: personnelRows.unitLabel,
      fourD: personnelRows.fourD,
      name: personnelRows.name,
      rank: personnelRows.rank,
      reasonCategory: personnelRows.reasonCategory,
      startDate: personnelRows.startDate,
      endDate: personnelRows.endDate,
      numDays: personnelRows.numDays,
      isPermanent: personnelRows.isPermanent,
      dutyType: personnelRows.dutyType,
      subReason: personnelRows.subReason,
      reportSickType: personnelRows.reportSickType,
      location: personnelRows.location,
    })
    .from(personnelRows)
    .innerJoin(paradeSubmissions, eq(personnelRows.paradeResponseId, paradeSubmissions.paradeResponseId))
    .orderBy(asc(paradeSubmissions.date), asc(personnelRows.id));
  return rows.map((r) => ({
    paradeResponseId: r.paradeResponseId,
    date: r.date,
    session: r.session,
    company: r.company,
    platoon: platoonFromLabel(r.unitLabel),
    fourD: r.fourD,
    name: r.name,
    rank: r.rank,
    reasonCategory: r.reasonCategory,
    startDate: r.startDate,
    endDate: r.endDate,
    numDays: personnelNumDays(r),
    reason: personnelReason(r),
    location: r.location,
  }));
}

/** Every command appointment, vacancies included and marked. */
async function roster(db: Db): Promise<RosterRow[]> {
  const rows = await db
    .select({
      paradeResponseId: paradeSubmissions.paradeResponseId,
      date: paradeSubmissions.date,
      session: paradeSubmissions.session,
      company: paradeSubmissions.company,
      roleKind: commandRosterRows.roleKind,
      unitLabel: commandRosterRows.unitLabel,
      rank: commandRosterRows.rank,
      name: commandRosterRows.name,
      vacant: commandRosterRows.isVacant,
    })
    .from(commandRosterRows)
    .innerJoin(paradeSubmissions, eq(commandRosterRows.paradeResponseId, paradeSubmissions.paradeResponseId))
    .orderBy(asc(paradeSubmissions.date), asc(commandRosterRows.id));
  return rows.map(({ roleKind, unitLabel, ...row }) => ({ ...row, role: rosterRole(roleKind, unitLabel) }));
}

/** Every report-sick submission, in Singapore time. */
async function formSg(db: Db): Promise<ReportSickRow[]> {
  const rows = await db
    .select({
      timestamp: reportSickFormsg.timestamp,
      rank: reportSickFormsg.rank,
      name: reportSickFormsg.name,
      fourD: reportSickFormsg.fourD,
      unitCoy: reportSickFormsg.unitCoy,
      company: reportSickFormsg.company,
      reportSickType: reportSickFormsg.reportSickType,
      reason: reportSickFormsg.reason,
      symptoms: reportSickFormsg.symptoms,
      outcome: reportSickFormsg.outcome,
      status1: reportSickFormsg.status1,
      status2: reportSickFormsg.status2,
      status3: reportSickFormsg.status3,
      status4: reportSickFormsg.status4,
      status5: reportSickFormsg.status5,
    })
    .from(reportSickFormsg)
    .orderBy(asc(reportSickFormsg.timestamp));
  return rows.map(({ status1, status2, status3, status4, status5, ...row }) => ({
    ...row,
    timestamp: sgtDateTime(row.timestamp),
    // Sheet-imported rows may predate the derived column.
    company: row.company ?? companyFromUnitCoy(row.unitCoy),
    statuses: [status1, status2, status3, status4, status5].map((status) => (status ?? '').trim()).filter(Boolean),
  }));
}

/** When each parade state was filed: its message's arrival, or a Sheet import's own timestamp. */
async function submissions(db: Db): Promise<FilingRow[]> {
  const rows = await db
    .select({
      paradeResponseId: paradeSubmissions.paradeResponseId,
      filedAt: sql<string>`coalesce(${rawMessages.receivedAt}, ${paradeSubmissions.extractedAt})`,
    })
    .from(paradeSubmissions)
    .leftJoin(rawMessages, eq(paradeSubmissions.sourceMessageId, rawMessages.id))
    .where(or(isNull(paradeSubmissions.model), ne(paradeSubmissions.model, UNTIMED_MODEL)))
    .orderBy(asc(paradeSubmissions.date));
  return rows.map((r) => ({ timestamp: sgtDateTime(r.filedAt), paradeResponseId: r.paradeResponseId }));
}

/** Every SFT session. */
async function sft(db: Db): Promise<SftSessionRow[]> {
  const rows = await db
    .select({
      timestamp: sftFormsg.timestamp,
      date: sftFormsg.sftDate,
      rank: sftFormsg.rank,
      name: sftFormsg.name,
      company: sftFormsg.company,
      groupIc: sftFormsg.groupIc,
      pesStatus: sftFormsg.pesStatus,
      exercises: sftFormsg.exercises,
      sfabtType: sftFormsg.sfabtType,
      location: sftFormsg.location,
    })
    .from(sftFormsg)
    .orderBy(asc(sftFormsg.timestamp));
  return rows.map((row) => ({ ...row, timestamp: sgtDateTime(row.timestamp) }));
}

/** The count each first-parade section header states. */
async function statedCounts(db: Db): Promise<SectionCountRow[]> {
  const rows = await db
    .select({
      paradeResponseId: sectionCounts.paradeResponseId,
      date: paradeSubmissions.date,
      company: paradeSubmissions.company,
      unitLabel: sectionCounts.unitLabel,
      reasonCategory: sectionCounts.reasonCategory,
      statedCount: sectionCounts.statedCount,
    })
    .from(sectionCounts)
    .innerJoin(paradeSubmissions, eq(sectionCounts.paradeResponseId, paradeSubmissions.paradeResponseId))
    .where(eq(paradeSubmissions.session, 'FPS'))
    .orderBy(asc(paradeSubmissions.date));
  return rows.map(({ unitLabel, ...row }) => ({ ...row, platoon: platoonFromLabel(unitLabel) }));
}

/** Reads every dataset the dashboard charts, connected as `dashboard_read`. */
export async function loadDashboard(db: Db): Promise<DashboardData> {
  const [strengthData, personnelData, rosterData, formSgData, submissionData, sftData, countData] = await Promise.all([
    strength(db),
    personnel(db),
    roster(db),
    formSg(db),
    submissions(db),
    sft(db),
    // Before migration 0008 grants it, section_counts is unreadable: that costs one empty dataset, not the dashboard.
    statedCounts(db).catch((error: { code?: string }) => {
      console.warn(`[dashboard] section_counts unreadable (${error?.code ?? 'no code'})`);
      return [];
    }),
  ]);
  return {
    strength: strengthData,
    personnel: personnelData,
    roster: rosterData,
    formSg: formSgData,
    submissions: submissionData,
    sft: sftData,
    sectionCounts: countData,
  };
}
