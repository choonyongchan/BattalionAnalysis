/**
 * Sheet schema for the FormSG ingestion module.
 *
 * The pipeline is:
 *
 *     FormSG  ->  Plumber  ->  this web app  ->  "Report Sick FormSG Responses"
 *                 (decrypts)
 *
 * Plumber owns decryption and the Singpass-verified fields, so Apps Script receives
 * plaintext JSON and does one job: map it to a row and append it. Nothing here
 * touches cryptography, secrets, or script properties.
 *
 * FORMSG_COLUMNS is the single source of truth for the sheet's shape. It mirrors
 * FormSG's own CSV-export layout, because a webhook row and a row pasted from a CSV
 * export must be indistinguishable — that is what keeps the two intake paths
 * interchangeable.
 */

/**
 * Name of the tab this module writes to.
 *
 * Deliberately the same tab FormSG's CSV export is pasted into. See the file header.
 * @type {string}
 */
const FORMSG_SHEET_NAME = 'Report Sick FormSG Responses';

/**
 * Header of the column holding submission timestamps.
 *
 * Named rather than inlined because two things depend on finding it: FormSgSheet
 * writes it, and FormSgTimestamps repairs it after a CSV import.
 * @type {string}
 */
const FORMSG_TIMESTAMP_HEADER = 'Timestamp';

/**
 * Header of the dedup key column. Must stay first in FORMSG_COLUMNS:
 * FormSgSheet.hasSubmissionId_ scans column 1.
 * @type {string}
 */
const FORMSG_RESPONSE_ID_HEADER = 'Response ID';

/**
 * Header of the column FormSG's CSV export fills with a fixed status string.
 * @type {string}
 */
const FORMSG_DOWNLOAD_STATUS_HEADER = 'Download Status';

/**
 * The value FORMSG_DOWNLOAD_STATUS_HEADER always carries, matching the CSV export.
 * @type {string}
 */
const FORMSG_DOWNLOAD_STATUS_VALUE = 'Success';

/**
 * The responses sheet's columns, in order.
 *
 * Three of these come from the request envelope rather than from an answer —
 * FORMSG_RESPONSE_ID_HEADER, FORMSG_TIMESTAMP_HEADER and
 * FORMSG_DOWNLOAD_STATUS_HEADER, all resolved in FormSgSheet.toRow_. Every other
 * header is looked up verbatim in the payload's `answers` object, so adding a
 * question to the form means adding its header here and mapping it in Plumber.
 *
 * "Masked NRIC" is CSV-only: Plumber exposes just the full verified NRIC, so
 * webhook rows leave that cell blank. The column is kept so that pasted CSV rows
 * still line up.
 * @type {string[]}
 */
const FORMSG_COLUMNS = [
  FORMSG_RESPONSE_ID_HEADER,
  FORMSG_TIMESTAMP_HEADER,
  FORMSG_DOWNLOAD_STATUS_HEADER,
  'RANK',
  '[Myinfo] Name',
  '4D Number (REC Only)',
  'Unit & Coy',
  'Report Sick Type',
  'Reason for Reporting Sick (Keep Brief)',
  'I am experiencing _____________________ symptoms.',
  'My symptoms are genuine and I have updated my Commander of my condition.',
  'SingPass Validated NRIC',
  'Masked NRIC',
];

/**
 * Everything about the responses sheet's shape: locating it, locating a column
 * within it, and checking that what is on the tab still matches FORMSG_COLUMNS.
 */
class FormSgSchema {
  /**
   * Returns the responses sheet, creating it with the header row if absent.
   * @returns {!GoogleAppsScript.Spreadsheet.Sheet} The responses sheet.
   */
  static sheet() {
    const spreadsheet = SpreadsheetApp.getActive();
    let sheet = spreadsheet.getSheetByName(FORMSG_SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(FORMSG_SHEET_NAME);
      sheet.getRange(1, 1, 1, FORMSG_COLUMNS.length).setValues([FORMSG_COLUMNS]);
    }
    return sheet;
  }

  /**
   * Finds a column's position by its header.
   * @param {string} header The header to look for.
   * @returns {number} The 1-based column index, or 0 when no such column exists.
   */
  static columnIndex(header) {
    return FORMSG_COLUMNS.indexOf(header) + 1;
  }

  /**
   * Diagnostic for a maintainer: confirms the tab exists and its header row matches
   * FORMSG_COLUMNS. Logs a pass/fail summary; does not throw.
   *
   * The header is only rewritten when the sheet holds no data rows. Once real rows
   * are present a mismatch is reported and left alone: with thousands of rows
   * underneath, silently rewriting row 1 from a wrong spec would mislabel every one
   * of them, so a human decides which side is wrong.
   * @returns {void}
   */
  static verify() {
    const sheet = FormSgSchema.sheet();
    const header = sheet.getRange(1, 1, 1, FORMSG_COLUMNS.length).getValues()[0];
    const mismatches = FORMSG_COLUMNS.map((column, i) =>
      header[i] === column ? null : `col ${i + 1}: sheet has "${header[i]}", spec wants "${column}"`
    ).filter((mismatch) => mismatch !== null);

    if (mismatches.length === 0) {
      Logger.log(`formSgVerifySetup: PASS — "${FORMSG_SHEET_NAME}" header matches FORMSG_COLUMNS.`);
      return;
    }

    if (sheet.getLastRow() < 2) {
      sheet.getRange(1, 1, 1, FORMSG_COLUMNS.length).setValues([FORMSG_COLUMNS]);
      Logger.log(`formSgVerifySetup: wrote the header row on "${FORMSG_SHEET_NAME}" (the sheet was empty).`);
      return;
    }

    Logger.log(`formSgVerifySetup: FAIL — "${FORMSG_SHEET_NAME}" header does not match FORMSG_COLUMNS, and the sheet has data:`);
    mismatches.forEach((mismatch) => Logger.log(`  ${mismatch}`));
    Logger.log('  Not rewriting it. Fix FORMSG_COLUMNS or the sheet by hand, then re-run.');
  }
}
