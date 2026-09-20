/**
 * Sheet layout, enums and identity rules for the parade-state parser.
 *
 * This file is the single source of truth for the shape of every tab the parser
 * reads or writes. Header rows are derived from the column arrays here, never the
 * reverse.
 *
 * Execution code only — there is no setup or diagnostic entry point in `src/`.
 * Secrets are set once through the Apps Script editor's Project Settings ->
 * Script Properties, and the checks a `verifySetup()` used to perform now happen
 * on the execution path: script-owned tabs are created on demand by `sheet_()`,
 * the Form-owned header is guarded in `ParserSheets.readText`, and a missing API
 * key throws from `ParserAi`. Everything that verifies behaviour lives in
 * `/test`, outside the clasp deployment boundary.
 */

/**
 * Names of every sheet tab the parser reads from or writes to.
 * @type {{RAW_RESPONSES: string, STRENGTH_DATA: string, PERSONNEL_DATA: string,
 *     COMMAND_ROSTER: string}}
 */
const SHEET_NAMES = {
  RAW_RESPONSES: 'Parade State Responses',
  STRENGTH_DATA: 'Strength Data',
  PERSONNEL_DATA: 'Personnel Data',
  COMMAND_ROSTER: 'Command Roster',
};

/**
 * Column headers, in order, for the "Parade State Responses" sheet.
 *
 * The first two columns are owned by the linked Google Form and must match its
 * question title exactly; the rest is the parser's own bookkeeping and is never
 * written by a Form submission.
 *
 * The row is the parser's only state. `parade_response_id` carries all of it:
 * empty means "not processed yet", a key like `Archer_2026-06-22_FPS` means
 * processed, and PARADE_ERROR_SENTINEL means the run failed with the reason in
 * `error`. Clearing the cell by hand is the one reprocess gesture — see
 * `Parser.onEditHandler`. While a run is in flight `error` holds
 * PARADE_PROCESSING_SENTINEL with `parade_response_id` still blank;
 * `ParserSheets.finishRow` overwrites `error` at the end of every completed run,
 * so that marker only lingers after a killed run, and such a row is still "due".
 *
 * `wa_message_id` is the WhatsApp bridge's idempotency key: the Baileys message
 * id a row came from, or '' for a row that arrived through the Form.
 * `ParserSheets.appendIfNew` scans it before appending, which is what stops one
 * redelivered message from costing a second AI extraction.
 * @type {string[]}
 */
const RAW_RESPONSES_COLUMNS = [
  'Timestamp',
  'Drop your Parade State here',
  'wa_message_id',
  'parade_response_id',
  'error',
];

/**
 * Value written to `parade_response_id` when a row fails to process, with the
 * reason written alongside it in `error`.
 *
 * Deliberately not a valid key: `paradeResponseId_` always produces
 * company_date_session, so this can never collide with a real one, and a failed
 * row is therefore invisible to every lookup that matches on a key.
 * @type {string}
 */
const PARADE_ERROR_SENTINEL = 'ERROR';

/**
 * Value written to `error` while a row is mid-flight, with `parade_response_id`
 * left blank.
 *
 * `Parser.processRow` writes it before extraction starts; `ParserSheets.finishRow`
 * overwrites both cells at the end of every completed run — cleared to '' on
 * success, replaced by the reason on failure. It therefore only survives when the
 * execution was killed between the two (script-lock timeout, an AI 5xx that
 * escapes, the 6-minute cap). A row with blank `parade_response_id` plus this
 * marker is a run that started and never finished: still "due", and every intake
 * treats it the same as a blank `error`.
 * @type {string}
 */
const PARADE_PROCESSING_SENTINEL = 'Processing...';

/**
 * Column headers, in order, for the "Strength Data" sheet. One row per
 * platoons[] entry per submission, including the mandatory company-total row
 * (platoon 'Company', unit_type UNIT_TYPES.COMPANY).
 * @type {string[]}
 */
const STRENGTH_DATA_COLUMNS = [
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
 * Column headers, in order, for the "Personnel Data" sheet. One row per
 * absentee/MC/sick/etc. entry, uniform across every reason_category.
 * start_date/end_date are ISO 'yyyy-MM-dd' (or '' when not stated); num_days is
 * the day count the message itself states, or '' when it states none — it is
 * never computed from the date pair, for the reasons in `ParserRows`' header.
 * The one exception is PERM_STATUS_NUM_DAYS: a permanent Status entry is written
 * with that sentinel regardless of what it stated, so "no expiry" is a single
 * integer check downstream rather than an inference from missing dates.
 * @type {string[]}
 */
const PERSONNEL_DATA_COLUMNS = [
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
  'in_camp',
];

/**
 * Column headers, in order, for the "Command Roster" sheet. One row per
 * command-team member listed in a message's header block (e.g. "CDO: 2LT
 * HARRY"). Companies whose messages carry no command team produce no rows.
 * @type {string[]}
 */
const COMMAND_ROSTER_COLUMNS = ['parade_response_id', 'date', 'session', 'company', 'role', 'rank', 'name'];

/**
 * The four script-owned tabs and their expected columns, used by `sheet_()` to
 * create a missing tab with its header row already in place.
 *
 * "Parade State Responses" is absent on purpose: it is Form-owned, so it is
 * never created or repaired here — `ParserSheets.readText` guards its header
 * instead.
 * @type {Array<Array<*>>}
 */
const SCRIPT_OWNED_SHEETS = [
  [SHEET_NAMES.STRENGTH_DATA, STRENGTH_DATA_COLUMNS],
  [SHEET_NAMES.PERSONNEL_DATA, PERSONNEL_DATA_COLUMNS],
  [SHEET_NAMES.COMMAND_ROSTER, COMMAND_ROSTER_COLUMNS],
];

/**
 * The six companies this battalion tracks. Used to validate the company the
 * model extracts from the parade-state text.
 * @type {string[]}
 */
const COMPANIES = ['Archer', 'Braves', 'Cougar', 'Stallion', 'Scorpion', 'Hercules'];

/**
 * Allowed values for the parade session (first parade of the day vs. last).
 * @type {{FPS: string, LPS: string}}
 */
const SESSIONS = {
  FPS: 'FPS',
  LPS: 'LPS',
};

/**
 * Allowed values for Personnel Data `reason_category`.
 * @type {string[]}
 */
const REASON_CATEGORIES = ['Att C', 'Status', 'Off/Leave', 'Report Sick', 'MA', 'Others'];

/**
 * Allowed values for a Strength Data row's `unit_type`, distinguishing an actual
 * platoon from a company command element (e.g. Cougar's "COMMANDERS: 20/25"), an
 * HQ block, or the mandatory company-total row, so downstream consumers never
 * treat a command-element or company-total headcount as if it were a platoon.
 * @type {{PLATOON: string, COMMAND_ELEMENT: string, HQ: string, COMPANY: string}}
 */
const UNIT_TYPES = {
  PLATOON: 'PLATOON',
  COMMAND_ELEMENT: 'COMMAND_ELEMENT',
  HQ: 'HQ',
  COMPANY: 'Company',
};

/**
 * Canonical roles for the Command Roster sheet, matching the header-block lines
 * seen in parade-state messages (e.g. "CDO: 2LT RYAN", "PDS 1: 3SG DENNIS TAN").
 * @type {string[]}
 */
const COMMAND_ROLES = ['CDO', 'CDS', 'COS', 'PDS1', 'PDS2', 'PDS3', 'PDS4'];

/**
 * Keys used to read this project's script properties.
 *
 * WHATSAPP_INGEST_TOKEN guards the `route=paradestate` web-app endpoint. The
 * FormSG endpoint next door is deliberately unauthenticated because its blast
 * radius is junk rows in one tab; this endpoint's blast radius is API spend,
 * since every accepted request triggers an extraction.
 * @type {{OPENAI_API_KEY: string, WHATSAPP_INGEST_TOKEN: string}}
 */
const SCRIPT_PROPERTY_KEYS = {
  OPENAI_API_KEY: 'OPENAI_API_KEY',
  WHATSAPP_INGEST_TOKEN: 'WHATSAPP_INGEST_TOKEN',
};

/**
 * Most rows one onEdit will reprocess when several `parade_response_id` cells are
 * cleared in a single gesture.
 *
 * A guard against the cheap mistake of selecting the whole column and pressing
 * Delete: each row costs an AI call, so an uncapped handler would burn spend and
 * hit the 6-minute execution limit anyway. Above the cap nothing is reprocessed
 * and the reason is logged. `Parser.reprocessPendingRows` shares this cap for the
 * same reason.
 * @type {number}
 */
const MAX_ONEDIT_REPROCESS_ROWS = 20;

/**
 * Chat completions endpoint used for extraction. The API key is sent as an
 * Authorization header at call time from script properties, never hardcoded.
 * @type {string}
 */
const OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

/**
 * Model used for parade-state extraction, on the Flex processing tier.
 *
 * Change this only after re-checking extraction accuracy and cost against real
 * parade-state messages, not on a hunch.
 * @type {string}
 */
const OPENAI_MODEL = 'gpt-5.6-luna';

/**
 * Earliest and latest plausible year for a date the model extracts.
 *
 * A date outside this window means a misread, not a real parade state, and is
 * rejected rather than written downstream — see `ParserRows.validate`.
 * @type {{MIN: number, MAX: number}}
 */
const PLAUSIBLE_YEARS = {
  MIN: 2020,
  MAX: 2100,
};

/**
 * `num_days` sentinel for a permanent status: "no expiry", not a real day count.
 *
 * A permanent Status entry has no end date and often no meaningful start date, so
 * `ParserRows` forces this value whenever an entry's `reason_category` is `Status`
 * and its `reason` names it permanent. Downstream reads it as a flag, never as a
 * duration.
 * @type {number}
 */
const PERM_STATUS_NUM_DAYS = 999;

/**
 * Sheet lookup and the identity rules every other parser file keys off of.
 */
class ParserSchema {
  /**
   * Looks up a sheet tab by name, creating it with its header row when it is one
   * of the script-owned tabs and does not exist yet.
   *
   * Creating on demand is what removes the need for a separate `verifySetup()`
   * entry point: the first write after a deploy provisions whatever is missing.
   * `FormSgSchema.sheet()` already works this way, so the two modules stay
   * symmetrical. The Form-owned responses tab is never created here — if it is
   * missing, the Form is not linked, and no amount of script work fixes that.
   * @param {string} name Sheet tab name (use SHEET_NAMES.* constants).
   * @returns {!GoogleAppsScript.Spreadsheet.Sheet} The matching sheet.
   * @throws {Error} If the tab is absent and not script-owned.
   */
  static sheet_(name) {
    const spreadsheet = SpreadsheetApp.getActive();
    const existing = spreadsheet.getSheetByName(name);
    if (existing) {
      return existing;
    }

    const owned = SCRIPT_OWNED_SHEETS.filter((entry) => entry[0] === name)[0];
    if (!owned) {
      throw new Error(`Sheet "${name}" not found. Link the Google Form's response sheet first.`);
    }

    const columns = owned[1];
    const created = spreadsheet.insertSheet(name);
    created.getRange(1, 1, 1, columns.length).setValues([columns]);
    Logger.log(`ParserSchema.sheet_: created missing tab "${name}" with its header row.`);
    return created;
  }

  /**
   * Finds a column's position within a column array.
   * @param {string[]} columns One of the *_COLUMNS arrays.
   * @param {string} header The header to look for.
   * @returns {number} The 1-based column index.
   */
  static columnIndex_(columns, header) {
    return columns.indexOf(header) + 1;
  }

  /**
   * Checks whether a string is a well-formed ISO 'yyyy-MM-dd' date in a
   * plausible year — the format the extraction prompt normalizes every date to.
   * @param {*} isoDate Candidate date string.
   * @returns {boolean} True if isoDate is a usable ISO date.
   */
  static isIsoDate_(isoDate) {
    if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
      return false;
    }
    const year = Number(isoDate.slice(0, 4));
    return year >= PLAUSIBLE_YEARS.MIN && year <= PLAUSIBLE_YEARS.MAX;
  }

  /**
   * Builds the deterministic key every output sheet is keyed by. A pure function
   * of the three identity fields the model extracts from the message text.
   * @param {string} company One of COMPANIES.
   * @param {string} isoDate ISO 'yyyy-MM-dd' date string.
   * @param {string} session One of SESSIONS's values ('FPS'/'LPS').
   * @returns {string} A key like "Archer_2026-07-18_FPS".
   */
  static paradeResponseId_(company, isoDate, session) {
    return `${company}_${isoDate}_${session}`;
  }
}
