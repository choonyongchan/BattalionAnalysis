/**
 * Receives Plumber's relayed FormSG submissions and appends one sheet row each.
 *
 * Plumber has already decrypted the submission, so the body that arrives here is
 * plain JSON keyed by this sheet's own column headers:
 *
 *     {
 *       "submissionId": "90fb87fbc8ad7733e37726a5",
 *       "submittedAt":  "2026-08-31T14:47:26.417+08:00",
 *       "answers": { "RANK": "LTA", "[Myinfo] Name": "PHUA CHU KANG", ... }
 *     }
 *
 * Two runtime constraints still shape this file:
 *
 * 1. ContentService always responds 200 — a status code cannot be set. So the two
 *    outcomes are deliberately distinguished:
 *      - permanent failure (a body that is not a submission): log it and return 200,
 *        because retrying will never change the result;
 *      - transient failure (lock contention, sheet unavailable): throw, which is the
 *        only way to produce a 5xx from Apps Script, so Plumber retries.
 *
 * 2. Apps Script web apps answer through a 302 redirect, which a webhook client can
 *    record as a failure even though doPost already ran and already wrote the row.
 *    appendIfNew_ therefore deduplicates on the submission id. This is the reason
 *    the append stayed in Apps Script rather than moving into Plumber, whose Sheets
 *    action appends unconditionally.
 *
 * The deployment must still be ANYONE_ANONYMOUS, because Plumber cannot authenticate
 * to Google. In front of that, the request must carry a shared secret matching the
 * FORMSG_INGEST_TOKEN script property, or it is rejected as `unauthorised`. Apps
 * Script cannot read request headers, so the token travels in the JSON body, exactly
 * as the parade-state route's does. The check fails closed: an unset property rejects
 * every request. See DeveloperGuide.md §8.4.
 */

/**
 * Script-property key holding the shared secret Plumber must send in the request
 * body. Kept next to its only reader.
 * @type {string}
 */
const FORMSG_INGEST_TOKEN_KEY = 'FORMSG_INGEST_TOKEN';

class FormSgSheet {
  /**
   * Handles one relayed submission end to end.
   *
   * @param {!Object} e The Apps Script doPost event object.
   * @returns {!GoogleAppsScript.Content.TextOutput} A JSON response body.
   * @throws {Error} On transient failures only, to trigger a Plumber retry.
   */
  static handlePost(e) {
    let submissionId = '';
    try {
      const body = FormSgSheet.parseBody_(e);
      if (!body) {
        Logger.log('FormSG: rejected a request whose body was not a Plumber submission.');
        return FormSgSheet.reply_({ ok: false, error: 'bad_request' });
      }
      if (!FormSgSheet.isAuthorised_(body.token)) {
        Logger.log('FormSG: rejected a request with a missing or incorrect ingest token.');
        return FormSgSheet.reply_({ ok: false, error: 'unauthorised' });
      }

      submissionId = String(body.submissionId);
      const appended = FormSgSheet.appendIfNew_(FormSgSheet.toRow_(body), submissionId);
      return FormSgSheet.reply_({ ok: true, submissionId: submissionId, appended: appended });
    } catch (err) {
      // Transient by assumption: log, then rethrow so Apps Script returns 5xx and
      // Plumber retries. A permanent failure would have returned 200 above.
      Logger.log(`FormSG: transient failure on submission "${submissionId}" — ${err}`);
      throw err;
    }
  }

  /**
   * Checks a request's shared token against the stored one.
   *
   * Fails closed: if FORMSG_INGEST_TOKEN was never set, `expected` is null and every
   * request is rejected rather than waved through. Mirrors Parser.isAuthorised_ on
   * the parade-state route.
   * @param {*} token The token supplied in the request body.
   * @returns {boolean} True if the token is present and matches the stored value.
   * @private
   */
  static isAuthorised_(token) {
    const expected = PropertiesService.getScriptProperties().getProperty(FORMSG_INGEST_TOKEN_KEY);
    return Boolean(expected) && String(token) === expected;
  }

  /**
   * Extracts the submission body from a request.
   *
   * A body without a `submissionId` is unusable: it is the dedup key, so accepting
   * one would let a retry write a duplicate row.
   *
   * @param {!Object} e The Apps Script doPost event object.
   * @returns {?Object} The parsed body, or null if it was absent, unparseable, or
   *     not shaped like a submission.
   * @private
   */
  static parseBody_(e) {
    try {
      if (!e || !e.postData || !e.postData.contents) return null;
      const body = JSON.parse(e.postData.contents);
      if (!body) return null;
      if (FormSgSheet.isRawFormSgWebhook_(body)) return null;
      if (!body.submissionId) return null;
      return body;
    } catch (err) {
      return null;
    }
  }

  /**
   * Detects FormSG's own webhook envelope, which this endpoint no longer accepts.
   *
   * Worth naming explicitly rather than letting it fall through the `submissionId`
   * check, because it is the one misconfiguration that fails invisibly: FormSG nests
   * its id under `data`, so the request is rejected — but ContentService still
   * answers 200, FormSG records the delivery as successful and never retries. Rows
   * simply stop arriving, with nothing anywhere to say why. Logging it by name is
   * what turns that into a five-second diagnosis.
   *
   * @param {!Object} body The parsed request body.
   * @returns {boolean} True if this is an encrypted FormSG webhook sent directly.
   * @private
   */
  static isRawFormSgWebhook_(body) {
    if (!body.data || !body.data.encryptedContent) return false;
    Logger.log(
      'FormSG: received an encrypted FormSG webhook directly. This endpoint expects ' +
        'Plumber to decrypt first — point the form\'s webhook at Plumber, not here. ' +
        'See README.md §8.3.'
    );
    return true;
  }

  /**
   * Shapes one submission into a row matching FORMSG_COLUMNS.
   *
   * Three columns come from the request envelope; every other header is looked up
   * verbatim in `answers`, so the sheet layout is changed by editing FORMSG_COLUMNS
   * and the Plumber mapping, and nothing here.
   *
   * @param {!Object} body The parsed submission body.
   * @returns {!Array<*>} One row, in column order.
   * @private
   */
  static toRow_(body) {
    const answers = body.answers || {};
    return FORMSG_COLUMNS.map((header) => {
      if (header === FORMSG_RESPONSE_ID_HEADER) return String(body.submissionId || '');
      if (header === FORMSG_TIMESTAMP_HEADER) return FormSgSheet.toDate_(body.submittedAt);
      if (header === FORMSG_DOWNLOAD_STATUS_HEADER) return FORMSG_DOWNLOAD_STATUS_VALUE;

      const answer = answers[header];
      return answer === undefined || answer === null ? '' : String(answer);
    });
  }

  /**
   * Converts the submission time into a Date cell value.
   *
   * Written as a real Date rather than a formatted string so the column sorts
   * chronologically and reads back as a date downstream. An unparseable value falls
   * back to the raw string rather than writing an Invalid Date.
   *
   * @param {*} submittedAt Plumber's `Submission Time`, an offset-aware ISO string.
   * @returns {(!Date|string)} A Date, or the original value if it did not parse.
   * @private
   */
  static toDate_(submittedAt) {
    if (!submittedAt) return '';
    const parsed = new Date(submittedAt);
    return isNaN(parsed.getTime()) ? String(submittedAt) : parsed;
  }

  /**
   * Appends a row unless its submission id is already present.
   *
   * This is what makes the endpoint idempotent under Plumber's retries and under the
   * Apps Script 302 behaviour described in the file header. The lock spans the
   * read-then-append so two concurrent retries cannot both decide the row is new.
   *
   * @param {!Array<*>} row The row to append, in column order.
   * @param {string} submissionId The dedup key.
   * @returns {boolean} True if a row was appended, false if it was a duplicate.
   * @throws {Error} If the script lock cannot be acquired (transient; triggers a retry).
   * @private
   */
  static appendIfNew_(row, submissionId) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('Could not acquire script lock within 30s');
    }
    try {
      const sheet = FormSgSchema.sheet();
      if (FormSgSheet.hasSubmissionId_(sheet, submissionId)) {
        return false;
      }
      sheet.appendRow(row);
      return true;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Scans the Response ID column for an existing entry.
   * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet The responses sheet.
   * @param {string} submissionId The id to look for.
   * @returns {boolean} True if the id is already recorded.
   * @private
   */
  static hasSubmissionId_(sheet, submissionId) {
    if (!submissionId) return false;
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return false;
    const column = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    return column.some((cells) => String(cells[0]) === submissionId);
  }

  /**
   * Serialises a response body for the caller.
   * @param {!Object} payload The object to return as JSON.
   * @returns {!GoogleAppsScript.Content.TextOutput} A JSON response.
   * @private
   */
  static reply_(payload) {
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  }
}
