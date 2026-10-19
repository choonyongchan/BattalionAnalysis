/** The battalion's vocabulary: the one source for every enum the database, parser and dashboard share. */

import { cleanText } from './identity.ts';

/** The five companies, in parade order. */
export const COMPANIES = ['Archer', 'Braves', 'Cougar', 'Stallion', 'Hercules'] as const;
/** Parade sessions; only FPS is ingested, LPS is recorded as rejected. */
export const SESSIONS = ['FPS', 'LPS'] as const;
/** Strength block levels; `Company` is the roll-up, so never sum across types. */
export const UNIT_TYPES = ['Company', 'HQ', 'PLATOON', 'SUBUNIT'] as const;
/** The six fixed section headers of a parade state. */
export const REASON_CATEGORIES = ['Att C', 'Status', 'Report Sick', 'MA', 'Off/Leave', 'Others'] as const;
/** Command appointments; a PDS's sub-unit lives in its unit label. */
export const ROLE_KINDS = ['CDO', 'CDS', 'COS', 'PDS'] as const;
/** Report-sick types; `PENDING` comes from parade states only. */
export const REPORT_SICK_TYPES = ['RSI', 'RSO', 'MR', 'FFI', 'PENDING'] as const;
/** FormSG doctor outcomes. */
export const OUTCOMES = ['MC', 'Status', 'Both', 'None'] as const;

export type Company = (typeof COMPANIES)[number];
export type Session = (typeof SESSIONS)[number];
export type UnitType = (typeof UNIT_TYPES)[number];
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];
export type RoleKind = (typeof ROLE_KINDS)[number];
export type ReportSickType = (typeof REPORT_SICK_TYPES)[number];

/** Whether a value is one of a fixed list, narrowing it to that list's type. */
export function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return list.includes(value as T);
}

/** Whether a value is one of the five companies. */
export function isCompany(value: unknown): value is Company {
  return isOneOf(COMPANIES, value);
}

/** A company's place in parade order (its colour slot on every chart), or -1. */
export function companyIndex(name: string): number {
  return COMPANIES.indexOf(name as Company);
}

/** The `unit_type` of a whole-company row; battalion strength sums only these to avoid double counting. */
export const UNIT_TYPE_COMPANY: UnitType = 'Company';

/** Company-level command roles, in duty roster order. */
export const COMMAND_ROLES: readonly string[] = ['CDO', 'CDS', 'COS'];

/** Each company's sub-units in roster order; rifle companies number on (Archer 1-3, Braves 4-6, Cougar 7-9). */
export const COMPANY_SUBUNITS: Record<Company, string[]> = {
  Archer: ['HQ', '1', '2', '3'],
  Braves: ['HQ', '4', '5', '6'],
  Cougar: ['HQ', '7', '8', '9'],
  Stallion: ['HQ', 'PNR', 'MTR', 'SCR', 'SIG'],
  Hercules: ['HQ', 'SIG', 'OPR+ASA', 'MED'],
};

/** Heatmap columns: a sub-unit's position within its company (`COMPANY_SUBUNITS[company][i]`). */
export const SUBUNIT_POSITIONS = ['Coy HQ', '1st Pl', '2nd Pl', '3rd Pl', '4th Pl'];

/** Index of a platoon (`7`, `PNR`, `HQ`) in `SUBUNIT_POSITIONS`, or -1 when the company has none. */
export function subunitPosition(company: string, platoon: unknown): number {
  const text = String(platoon ?? '').toUpperCase().replace(/\s+/g, '');
  const unit = text === 'COYHQ' ? 'HQ' : text;
  return (isCompany(company) ? COMPANY_SUBUNITS[company] : []).indexOf(unit);
}

/** Roster roles one company files: command roles, then a PDS per sub-unit (`PDS7`, `PDSOPR+ASA`). */
export function commandRolesOf(company: string): string[] {
  const units = isCompany(company) ? COMPANY_SUBUNITS[company] : [];
  return [...COMMAND_ROLES, ...units.filter((unit) => unit !== 'HQ').map((unit) => 'PDS' + unit)];
}

/** `num_days` a permanent status carries: "no expiry", not a duration. */
export const PERM_STATUS_NUM_DAYS = 999;

/** Label for a row that names no platoon. */
export const UNASSIGNED = 'Unassigned';

/** Numbered platoon blocks: `PL 7`, `PLT 3`, `PLATOON 1`, `PL2`. */
export const PLATOON_LABEL = /^(?:PL|PLT|PLATOON)\s*\d+$/;
/** Headquarters blocks: `COY HQ`, `HQ`. */
export const HQ_LABEL = /^(?:COY\s*)?HQ$/;

/** Classifies a block label; anything not roll-up, HQ or numbered platoon is a named SUBUNIT. */
export function unitTypeOf(unitLabel: string): UnitType {
  const label = cleanText(unitLabel).toUpperCase().trim();
  if (label === 'COMPANY') return 'Company';
  if (HQ_LABEL.test(label)) return 'HQ';
  if (PLATOON_LABEL.test(label)) return 'PLATOON';
  return 'SUBUNIT';
}

/** Company named in FormSG's `Unit & Coy` answer (`Hercules & Bn HQ` is Hercules), or null. */
export function companyFromUnitCoy(unitCoy: string | null | undefined): Company | null {
  if (!unitCoy) return null;
  const value = cleanText(String(unitCoy)).toUpperCase();
  return COMPANIES.find((company) => value.includes(company.toUpperCase())) ?? null;
}

/** A parade submission's natural key, e.g. `Archer_2026-09-18_FPS`; computable so one `db.batch` can replace it. */
export function paradeResponseId(company: string, isoDate: string, session: string): string {
  return `${company}_${isoDate}_${session}`;
}

const PARADE_RESPONSE_ID = /^([A-Za-z]+)_(\d{4}-\d{2}-\d{2})_([A-Za-z0-9]+)$/;

/** Splits a `paradeResponseId`, or null when it is malformed or names an unknown company. */
export function parseParadeResponseId(id: string): { company: Company; date: string; session: string } | null {
  const match = PARADE_RESPONSE_ID.exec(id);
  if (!match || !isCompany(match[1])) return null;
  return { company: match[1], date: match[2]!, session: match[3]! };
}
