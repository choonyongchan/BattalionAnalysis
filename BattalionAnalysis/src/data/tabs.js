/**
 * What the dashboard requires of each spreadsheet tab.
 *
 * This is the read-side mirror of `src/parser/ParserSchema.js` and
 * `src/formsg/FormSgColumns.js`, which remain the single source of truth for the sheet's
 * shape. Nothing here defines layout — it names the subset of headers the dashboard
 * actually reads, so a tab it cannot understand fails loudly with the missing header
 * named rather than silently charting the wrong column.
 *
 * Columns are resolved by header name at read time, so a column added or reordered
 * upstream is harmless. What is not harmless is reading `reason` out of the `location`
 * column, which charts cleanly and is entirely wrong.
 *
 * `test/dashboard/schema.test.js` asserts every header named here still exists in the
 * canonical column arrays.
 */

/**
 * Names of the tabs the dashboard reads.
 *
 * `SUBMISSIONS` is the raw parade-state intake, read through a *column projection*: the
 * feed returns only `Timestamp` and `parade_response_id` from it. The message body is
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
  HOLIDAYS: 'Public Holidays',
  ROTATIONS: 'Rotations',
};

/**
 * Headers read from "Strength Data".
 *
 * The rank tiers are read as well as the totals: a present rate by rank tier costs
 * nothing once the columns are here, and they are already written on every row.
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
 * @type {string[]}
 */
export const ROSTER_HEADERS = ['parade_response_id', 'date', 'session', 'company', 'role', 'rank', 'name'];

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
 * Headers read from "Public Holidays".
 * @type {string[]}
 */
export const HOLIDAY_HEADERS = ['date', 'name'];

/**
 * Headers read from "Rotations".
 * @type {string[]}
 */
export const ROTATION_HEADERS = ['name', 'start_date', 'end_date'];

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
 * full names and diagnoses in one blob, so it is projected away on the Apps Script side
 * and named here so a test can prove it never came back.
 * @type {string[]}
 */
export const FORBIDDEN_SUBMISSION_HEADERS = ['Drop your Parade State here'];

/**
 * Tabs the dashboard works without, and what to say when one is absent.
 *
 * A battalion that has not set up the report-sick form, or has not created the two
 * settings tabs, should get a working dashboard with a note rather than an error naming a
 * tab they have never heard of.
 * @type {!Object<string, string>}
 */
export const OPTIONAL_TABS = {
  [TABS.FORMSG]: 'Report-sick submissions are unavailable.',
  [TABS.SUBMISSIONS]: 'Parade-state filing times are unavailable.',
  [TABS.HOLIDAYS]: 'Public holidays are not marked on any chart.',
  [TABS.ROTATIONS]: 'Rotational grouping is unavailable.',
};
