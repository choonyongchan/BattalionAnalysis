/** Dashboard rows for tests: each builder fills every field a test leaves out with a blank. */

import type {
  FilingRow,
  PersonnelRow,
  ReportSickRow,
  RosterRow,
  SectionCountRow,
  SftSessionRow,
  StrengthRow,
} from '../../shared/dashboard.ts';
import type { Episode } from '../../frontend/src/model/episodes.ts';
import { toSubmissions, type Submission } from '../../frontend/src/model/formsg.ts';
import type { Dataset } from '../../frontend/src/data/feed.ts';
import type { SftSession } from '../../frontend/src/model/sft.ts';
import { defaultSettings } from '../../shared/settings/resolve.ts';

/** A personnel row; unset fields are blank. */
export function personnelRow(spec: Partial<PersonnelRow>): PersonnelRow {
  return {
    paradeResponseId: '',
    date: '',
    session: 'FPS',
    company: 'Archer',
    platoon: '',
    fourD: null,
    name: '',
    rank: null,
    reasonCategory: 'Others',
    startDate: null,
    endDate: null,
    numDays: null,
    reason: '',
    location: null,
    ...spec,
  };
}

/** Personnel rows from terse specs. */
export const personnelRows = (specs: Partial<PersonnelRow>[]): PersonnelRow[] => specs.map(personnelRow);

/** A strength row; unset counts are 0 (totals) or null (rank tiers). */
export function strengthRow(spec: Partial<StrengthRow>): StrengthRow {
  return {
    paradeResponseId: '',
    date: '',
    session: 'FPS',
    company: 'Archer',
    platoon: '',
    unitType: 'Company',
    totalStrength: 0,
    totalPresent: 0,
    officerStrength: null,
    officerPresent: null,
    wospecStrength: null,
    wospecPresent: null,
    enlisteeStrength: null,
    enlisteePresent: null,
    ...spec,
  };
}

/** Strength rows from terse specs. */
export const strengthRows = (specs: Partial<StrengthRow>[]): StrengthRow[] => specs.map(strengthRow);

/** A command roster row. */
export function rosterRow(spec: Partial<RosterRow>): RosterRow {
  return { paradeResponseId: '', date: '', session: 'FPS', company: 'Archer', role: '', rank: null, name: null, vacant: false, ...spec };
}

/** A report-sick FormSG row. */
export function reportSickRow(spec: Partial<ReportSickRow>): ReportSickRow {
  return {
    timestamp: '',
    rank: null,
    name: null,
    fourD: null,
    unitCoy: null,
    company: null,
    reportSickType: null,
    reason: null,
    symptoms: null,
    outcome: null,
    statuses: [],
    ...spec,
  };
}

/** A filing row. */
export function filingRow(spec: Partial<FilingRow>): FilingRow {
  return { timestamp: '', paradeResponseId: '', ...spec };
}

/** An SFT session row. */
export function sftRow(spec: Partial<SftSessionRow>): SftSessionRow {
  return {
    timestamp: '',
    date: '',
    rank: null,
    name: null,
    company: null,
    groupIc: null,
    pesStatus: null,
    exercises: null,
    sfabtType: null,
    location: null,
    ...spec,
  };
}

/** A stated section count. */
export function sectionCountRow(spec: Partial<SectionCountRow>): SectionCountRow {
  return { paradeResponseId: '', date: '', company: 'Archer', platoon: '', reasonCategory: 'Status', statedCount: null, ...spec };
}

/** An episode as `buildEpisodes` returns it; unset fields are blank, one day observed. */
export function episode(spec: Partial<Episode>): Episode {
  return {
    key: '',
    dutyClass: 'Att C',
    fourD: '',
    name: '',
    rank: '',
    company: '',
    platoon: '',
    startDate: null,
    endDate: null,
    paradeDates: [],
    observedDays: 1,
    statedDays: null,
    spanDays: null,
    permanent: false,
    daysLost: 1,
    daysLostSource: 'observed',
    disagreement: false,
    reasons: [],
    symptoms: [],
    rowCount: 1,
    ...spec,
  };
}

/** Roster rows from terse specs. */
export const rosterRows = (specs: Partial<RosterRow>[]): RosterRow[] => specs.map(rosterRow);

/** Normalised submissions from terse FormSG row specs. */
export const submissionsOf = (specs: Partial<ReportSickRow>[]): Submission[] => toSubmissions(specs.map(reportSickRow));

/** A loaded dataset with no rows and default settings, unless the spec says otherwise. */
export function dataset(spec: Partial<Dataset>): Dataset {
  return {
    strength: [],
    personnel: [],
    roster: [],
    formSg: [],
    submissions: [],
    sft: [],
    sectionCounts: [],
    generatedAt: '',
    notes: {},
    settings: defaultSettings(),
    settingsMeta: {},
    canEdit: false,
    holidays: [],
    rotations: [],
    ...spec,
  };
}

/** A normalised SFT session; unset fields are blank. */
export function sftSession(spec: Partial<SftSession>): SftSession {
  return {
    date: '',
    timestamp: '',
    rank: '',
    name: '',
    key: '',
    company: '',
    groupIc: '',
    pesStatus: '',
    exercises: [],
    sfabtType: '',
    location: '',
    ...spec,
  };
}

/** A normalised submission; unset fields are blank. */
export function submission(spec: Partial<Submission>): Submission {
  return {
    date: '',
    timestamp: '',
    rank: '',
    name: '',
    fourD: '',
    key: '',
    company: '',
    unitText: '',
    reportSickType: '',
    outcome: '',
    statuses: [],
    reason: '',
    symptomAnswer: '',
    text: '',
    symptoms: [],
    keywords: [],
    ...spec,
  };
}
