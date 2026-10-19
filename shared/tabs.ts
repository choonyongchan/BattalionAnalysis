/**
 * The columns the dashboard reads from each tab; `backend/lib/dashboard.ts` selects only these,
 * so a column leaves the database only if it is listed here.
 */

/** Names of the tabs the dashboard reads. */
export const TABS = {
  STRENGTH: 'Strength Data',
  PERSONNEL: 'Personnel Data',
  ROSTER: 'Command Roster',
  FORMSG: 'Report Sick FormSG Responses',
  SUBMISSIONS: 'Parade State Responses',
  SFT: 'SFT Responses',
  SECTION_COUNTS: 'Section Counts',
} as const;

/** Strength columns; rank-tier columns are blank where a parade state gave no split (a gap, not zero). */
export const STRENGTH_HEADERS = [
  'parade_response_id',
  'date',
  'session',
  'company',
  'platoon',
  'unit_type',
  'total_strength',
  'total_present',
  'officer_strength',
  'officer_present',
  'wospec_strength',
  'wospec_present',
  'enlistee_strength',
  'enlistee_present',
];

/** Personnel columns; `location` names a clinic, never a person. */
export const PERSONNEL_HEADERS = [
  'parade_response_id',
  'date',
  'session',
  'company',
  'platoon',
  'four_d',
  'name',
  'rank',
  'reason_category',
  'start_date',
  'end_date',
  'num_days',
  'reason',
  'location',
];

/** Command roster columns; `vacant` marks an appointment filed as `-`. */
export const ROSTER_HEADERS = ['parade_response_id', 'date', 'session', 'company', 'role', 'rank', 'name', 'vacant'];

/** The five repeated "Status Given" answers. */
export const FORMSG_STATUS_HEADERS = [1, 2, 3, 4, 5].map((n) => 'Status Given #' + n);

/** Report-sick FormSG columns; no NRIC column, ever. */
export const FORMSG_HEADERS = [
  'Timestamp',
  'RANK',
  '[Myinfo] Name',
  '4D Number (REC Only)',
  'Unit & Coy',
  'Report Sick Type',
  'Reason for Reporting Sick (Keep Brief)',
  'I am experiencing _____________________ symptoms.',
  'Outcome given by the doctor/MO',
  ...FORMSG_STATUS_HEADERS,
];

/** Filing columns: when a company filed and for which parade; never the message body. */
export const SUBMISSION_HEADERS = ['Timestamp', 'parade_response_id'];

/** SFT columns, one row per session. */
export const SFT_HEADERS = [
  'Timestamp',
  'date',
  'RANK',
  'name',
  'company',
  'group_ic',
  'PES Status',
  'exercises',
  'sfabt_type',
  'location',
];

/** Stated section counts, to compare with the names each section lists. */
export const SECTION_COUNT_HEADERS = ['parade_response_id', 'date', 'company', 'platoon', 'reason_category', 'stated_count'];

/** FormSG columns that must never be requested; tests assert their absence. */
export const FORBIDDEN_HEADERS = ['SingPass Validated NRIC', 'Masked NRIC'];

/** The parade-state message body (NRICs, names, diagnoses); must never be requested. */
export const FORBIDDEN_SUBMISSION_HEADERS = ['Drop your Parade State here'];

/** Tabs the dashboard works without, and the note shown when one is empty. */
export const OPTIONAL_TABS: Record<string, string> = {
  [TABS.FORMSG]: 'Report-sick submissions are unavailable.',
  [TABS.SUBMISSIONS]: 'Parade-state filing times are unavailable.',
  [TABS.SFT]: 'SFT submissions are unavailable.',
  [TABS.SECTION_COUNTS]: 'Stated section counts are unavailable.',
};
