/**
 * What the dashboard requires of each tab.
 *
 * The data lives in Neon now; `lib/dashboard.ts` answers with the tabs the retired Google
 * Sheet held, under the same names and headers, so everything in `model/` reads it
 * unchanged. `lib/dashboard.ts` builds each tab from the header arrays here, so they are
 * also the server's list of what may leave the database. Nothing here defines layout — it
 * names the subset of headers the dashboard actually reads, so a tab it cannot understand fails loudly with the missing header
 * named rather than silently charting the wrong column.
 *
 * Columns are resolved by header name at read time, so a column added or reordered
 * upstream is harmless. What is not harmless is reading `reason` out of the `location`
 * column, which charts cleanly and is entirely wrong.
 */

/**
 * Names of the tabs the dashboard reads.
 *
 * `SUBMISSIONS` is the raw parade-state intake, read through a *column projection*: the
 * server returns only `Timestamp` and `parade_response_id` from it. The message body is
 * free text a duty commander typed, and it routinely contains NRICs — it must never
 * cross the boundary. See `FORBIDDEN_HEADERS`.
 * @type {!Object<string, string>}
 */
export const TABS = {
  STRENGTH: 'Strength Data',
  PERSONNEL: 'Personnel Data',
  ROSTER: 'Command Roster',
  FORMSG: 'Report Sick FormSG Responses',
  SUBMISSIONS: 'Parade State Responses',
};

/**
 * Headers read from "Strength Data".
 *
 * The six rank-tier columns split `total_*` into officers, WOSpecs and enlistees. They are
 * blank where a parade state did not state the split, which is a gap, never a zero.
 * @type {string[]}
 */
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

/**
 * Headers read from "Personnel Data".
 *
 * `location` is read for the clinic ranking on the MC/MA page. It names a hospital or
 * medical centre, never a person. `in_camp` is still not read — nothing charts it yet.
 * @type {string[]}
 */
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

/**
 * Headers read from "Command Roster".
 *
 * `parade_response_id` is read here, unlike before: two company-days in the observed data
 * carry two submissions, and the id is what distinguishes them so the later one can win.
 * `vacant` is true for an appointment the parade state filed as `-`: vacant, not unfiled.
 * @type {string[]}
 */
export const ROSTER_HEADERS = ['parade_response_id', 'date', 'session', 'company', 'role', 'rank', 'name', 'vacant'];

/**
 * The five repeated "Status Given" answers, under the form's own `#n` titles.
 * @type {string[]}
 */
export const FORMSG_STATUS_HEADERS = [1, 2, 3, 4, 5].map((n) => 'Status Given #' + n);

/**
 * Headers read from "Report Sick FormSG Responses".
 *
 * Deliberately excludes both NRIC columns. The dashboard has no use for an NRIC, so it
 * never asks for one — the narrowest read is the one that cannot leak.
 * @type {string[]}
 */
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

/**
 * Headers read from "Parade State Responses".
 *
 * Two columns out of five. `Timestamp` answers when a company filed; `parade_response_id`
 * says which company and date it filed for. Nothing else is requested.
 * @type {string[]}
 */
export const SUBMISSION_HEADERS = ['Timestamp', 'parade_response_id'];

/**
 * FormSG headers the dashboard must never request.
 *
 * Named rather than merely omitted so `test/dashboard/schema.test.js` can assert their
 * absence. An accidental paste into a header array then fails a test instead of shipping.
 * @type {string[]}
 */
export const FORBIDDEN_HEADERS = ['SingPass Validated NRIC', 'Masked NRIC'];

/**
 * Parade State Responses headers the dashboard must never request.
 *
 * The message body is free text a duty commander typed. Observed messages contain NRICs,
 * full names and diagnoses in one blob, so the server never selects it (and its read-only
 * role cannot) and it is named here so a test can prove it is never requested.
 * @type {string[]}
 */
export const FORBIDDEN_SUBMISSION_HEADERS = ['Drop your Parade State here'];

/**
 * Tabs the dashboard works without, and what to say when one is absent.
 *
 * A battalion that has not set up the report-sick form, or has not set up the calendar,
 * should get a working dashboard with a note rather than an error naming a tab they have
 * never heard of.
 * @type {!Object<string, string>}
 */
export const OPTIONAL_TABS = {
  [TABS.FORMSG]: 'Report-sick submissions are unavailable.',
  [TABS.SUBMISSIONS]: 'Parade-state filing times are unavailable.',
};
