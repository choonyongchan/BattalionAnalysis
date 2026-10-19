/**
 * The rows `/api/dashboard` returns, one array per dataset.
 * `backend/lib/dashboard.ts` selects exactly these fields; never add an NRIC or a message body.
 */

import type { Company, ReasonCategory, Session, UnitType } from './domain.ts';

/** One strength block of a parade state; rank-tier counts are null when not stated (a gap, not zero). */
export interface StrengthRow {
  paradeResponseId: string;
  date: string;
  session: Session;
  company: Company;
  /** `1`, `HQ`, a named sub-unit such as `SIG`, or '' for the company roll-up. */
  platoon: string;
  unitType: UnitType;
  totalStrength: number;
  totalPresent: number;
  officerStrength: number | null;
  officerPresent: number | null;
  wospecStrength: number | null;
  wospecPresent: number | null;
  enlisteeStrength: number | null;
  enlisteePresent: number | null;
}

/** One person listed under a section of a parade state; `location` names a clinic, never a person. */
export interface PersonnelRow {
  paradeResponseId: string;
  date: string;
  session: Session;
  company: Company;
  platoon: string;
  fourD: string | null;
  name: string;
  rank: string | null;
  reasonCategory: ReasonCategory;
  startDate: string | null;
  endDate: string | null;
  /** Stated day count; `PERM_STATUS_NUM_DAYS` for a permanent status. */
  numDays: number | null;
  /** e.g. `MC`, `EXCUSE (HEAVY LOADS)`, `PERM EXCUSE (KNEELING)`. */
  reason: string;
  location: string | null;
}

/** One command appointment; `vacant` means filed as `-`, not unfiled. */
export interface RosterRow {
  paradeResponseId: string;
  date: string;
  session: Session;
  company: Company;
  /** `CDO`, `CDS`, `COS`, or `PDS` + sub-unit (`PDS7`, `PDSSIG`). */
  role: string;
  rank: string | null;
  name: string | null;
  vacant: boolean;
}

/** One report-sick FormSG submission; `timestamp` is Singapore-local `yyyy-MM-ddTHH:mm:ss`. */
export interface ReportSickRow {
  timestamp: string;
  rank: string | null;
  name: string | null;
  fourD: string | null;
  unitCoy: string | null;
  company: Company | null;
  reportSickType: string | null;
  reason: string | null;
  symptoms: string | null;
  outcome: string | null;
  /** The non-blank "Status Given" answers, in form order. */
  statuses: string[];
}

/** When a company filed a parade state (Singapore-local), and for which parade. */
export interface FilingRow {
  timestamp: string;
  paradeResponseId: string;
}

/** One self-regulated fitness training session. */
export interface SftSessionRow {
  timestamp: string;
  date: string;
  rank: string | null;
  name: string | null;
  company: Company | null;
  groupIc: string | null;
  pesStatus: string | null;
  exercises: string | null;
  sfabtType: string | null;
  location: string | null;
}

/** The count a section header states, to compare with the names it lists. */
export interface SectionCountRow {
  paradeResponseId: string;
  date: string;
  company: Company;
  platoon: string;
  reasonCategory: ReasonCategory;
  statedCount: number | null;
}

/** Every dataset the dashboard reads. */
export interface DashboardData {
  strength: StrengthRow[];
  personnel: PersonnelRow[];
  roster: RosterRow[];
  formSg: ReportSickRow[];
  submissions: FilingRow[];
  sft: SftSessionRow[];
  sectionCounts: SectionCountRow[];
}

/** Datasets the dashboard works without, and the note shown when one is empty. */
export const OPTIONAL_DATASETS = {
  formSg: 'There are no report-sick submissions yet.',
  submissions: 'There are no parade-state filing times yet.',
  sft: 'There are no SFT submissions yet.',
  sectionCounts: 'There are no stated section counts yet.',
} as const satisfies Partial<Record<keyof DashboardData, string>>;
