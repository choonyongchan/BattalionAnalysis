/**
 * Every way a parade state enters the pipeline, plus the processing core that
 * turns one response row into Strength Data / Personnel Data / Command Roster
 * rows.
 *
 * Three entry points, all converging on `processRow`:
 *   - `handlePost` — the WhatsApp bridge POSTs a relayed message to the web app
 *     (`route=paradestate`); the row is appended and processed in one execution.
 *     This is the primary intake.
 *   - `onEditHandler` — a maintainer clears a row's `parade_response_id` by hand
 *     to force a re-run. This is the only reprocess gesture, and the only state
 *     the pipeline keeps.
 *   - `onFormSubmitHandler` — the Google Form, kept as a manual fallback. It
 *     needs its own trigger because a Form submission does not fire `onEdit`.
 *
 * The trigger-driven entry points are installable triggers, not simple
 * `onEdit(e)`/`onFormSubmit(e)` functions, because simple triggers cannot call
 * `UrlFetchApp` — installing them once from the editor grants the OAuth
 * authorization simple triggers lack.
 */
class Parser {
  /**
   * Runs the pipeline for one response row: extract, derive, validate, then
   * replace that key's output rows, and record the outcome on the row itself.
   *
   * One row's failure never throws past this method. Both an extraction failure
   * and a validation failure land the same way — PARADE_ERROR_SENTINEL in
   * `parade_response_id` and the reason in `error` — because the operator's next
   * action is the same either way: fix the message, clear the id, let it re-run.
   *
   * Before the `try`, the row is stamped PARADE_PROCESSING_SENTINEL in `error`
   * with the id left blank. Every completed run overwrites `error` again, so a row
   * left showing that marker with a blank id is a run that was killed mid-flight —
   * self-identifying, and still "due".
   *
   * `previousId` exists for the case where a maintainer corrects a message's date
   * or company and then clears the id. The row then processes to a *different*
   * key, and without this the old key's output rows would be orphaned in all
   * three tabs with nothing left pointing at them.
   * @param {number} rowIndex 1-based response row to process.
   * @param {string} [previousId=''] The key this row held before it was cleared.
   * @returns {void}
   */
  static processRow(rowIndex, previousId) {
    const text = ParserSheets.readText(rowIndex);
    if (text === null || !text.trim()) {
      return;
    }

    ParserSheets.markProcessing(rowIndex);

    try {
      const extraction = ParserAi.extract(text);
      const issue = ParserRows.validate(extraction);
      if (issue) {
        throw new Error(issue);
      }

      const paradeResponseId = ParserSchema.paradeResponseId_(
        extraction.company,
        extraction.date,
        extraction.session
      );

      if (previousId && previousId !== paradeResponseId && previousId !== PARADE_ERROR_SENTINEL) {
        ParserSheets.deleteOutputsForKey(previousId);
      }
      ParserSheets.deleteOutputsForKey(paradeResponseId);

      // Deleting an earlier duplicate above this row shifts this row up, so the
      // outcome has to be written to where the row now is, not where it started.
      const removedAbove = ParserSheets.deleteDuplicateRawResponses_(paradeResponseId, rowIndex);
      const currentRow = rowIndex - removedAbove;

      ParserSheets.appendRows(
        SHEET_NAMES.STRENGTH_DATA,
        STRENGTH_DATA_COLUMNS,
        ParserRows.buildStrengthRows(extraction, paradeResponseId)
      );
      ParserSheets.appendRows(
        SHEET_NAMES.PERSONNEL_DATA,
        PERSONNEL_DATA_COLUMNS,
        ParserRows.buildPersonnelRows(extraction, paradeResponseId)
      );
      ParserSheets.appendRows(
        SHEET_NAMES.COMMAND_ROSTER,
        COMMAND_ROSTER_COLUMNS,
        ParserRows.buildCommandRosterRows(extraction, paradeResponseId)
      );

      ParserSheets.finishRow(currentRow, paradeResponseId, '');
    } catch (err) {
      Logger.log(`Parser.processRow: row ${rowIndex} failed — ${err.message}`);
      ParserSheets.finishRow(rowIndex, PARADE_ERROR_SENTINEL, err.message);
    }
  }

  /**
   * Web-app handler for the WhatsApp bridge (`route=paradestate`): records one
   * relayed message as a response row and processes it in the same execution, so
   * a parade state posted in the group lands in Strength Data within seconds.
   *
   * Failure contract matches the FormSG endpoint's: ContentService cannot set a
   * status code, so a permanent failure — bad body, wrong token — is logged and
   * answered 200, because no retry will fix it, while a transient failure is
   * rethrown, the only way to make Apps Script emit a 5xx and get the bridge to
   * resend.
   *
   * A failed *extraction* is not a failure of this endpoint: `processRow` records
   * every such outcome on the row and never throws, so the bridge is told the
   * relay succeeded and does not resend.
   *
   * A redelivery whose row is already recorded but *still blank* — a first
   * delivery whose `processRow` was killed before it finished — is reprocessed in
   * this execution. Only a row already carrying a key or PARADE_ERROR_SENTINEL is
   * logged and skipped. This is what lets the bridge's resend, the whole recovery
   * mechanism, actually recover a stranded first delivery.
   * @param {!Object} e The Apps Script doPost event object.
   * @returns {!GoogleAppsScript.Content.TextOutput} A JSON response body.
   * @throws {Error} On transient failures only, to trigger a resend.
   */
  static handlePost(e) {
    let messageId = '';
    try {
      const body = Parser.parseBody_(e);
      if (!body) {
        Logger.log('Parser: rejected a request whose body was not a parade-state relay.');
        return Parser.reply_({ ok: false, error: 'bad_request' });
      }
      if (!Parser.isAuthorised_(body.token)) {
        Logger.log('Parser: rejected a request with a missing or incorrect ingest token.');
        return Parser.reply_({ ok: false, error: 'unauthorised' });
      }

      messageId = String(body.messageId);
      const { rowIndex, appended } = ParserSheets.appendIfNew(String(body.text), messageId);
      if (!appended) {
        const existingId = ParserSheets.readParadeResponseId(rowIndex);
        if (!existingId) {
          Logger.log(`Parser: message "${messageId}" at row ${rowIndex} is still due; reprocessing on redelivery.`);
          Parser.processRow(rowIndex, '');
          return Parser.reply_({ ok: true, messageId: messageId, appended: false, rowIndex: rowIndex });
        }
        Logger.log(
          `Parser: message "${messageId}" is already recorded at row ${rowIndex} as "${existingId}"; not reprocessing.`
        );
        return Parser.reply_({ ok: true, messageId: messageId, appended: false, rowIndex: rowIndex });
      }

      Parser.processRow(rowIndex, '');
      return Parser.reply_({ ok: true, messageId: messageId, appended: true, rowIndex: rowIndex });
    } catch (err) {
      // Transient by assumption: a permanent failure returned 200 above.
      Logger.log(`Parser: transient failure on message "${messageId}" — ${err}`);
      throw err;
    }
  }

  /**
   * Extracts the relay body from a request.
   *
   * A body missing `messageId` is unusable: it is the dedup key, so accepting one
   * would let a resend write a duplicate row and pay for a second extraction.
   * @param {!Object} e The Apps Script doPost event object.
   * @returns {?Object} The parsed body, or null if absent, unparseable, or not
   *     shaped like a relay.
   */
  static parseBody_(e) {
    try {
      if (!e || !e.postData || !e.postData.contents) {
        return null;
      }
      const body = JSON.parse(e.postData.contents);
      if (!body || !body.messageId || !body.text) {
        return null;
      }
      return body;
    } catch (err) {
      return null;
    }
  }

  /**
   * Checks a request's shared token against the stored one.
   *
   * Fails closed: if the script property was never set, every request is rejected
   * rather than waved through.
   * @param {*} token The token supplied by the caller.
   * @returns {boolean} True if the token matches the stored value.
   */
  static isAuthorised_(token) {
    const expected = PropertiesService.getScriptProperties().getProperty(
      SCRIPT_PROPERTY_KEYS.WHATSAPP_INGEST_TOKEN
    );
    return Boolean(expected) && String(token) === expected;
  }

  /**
   * Serialises a response body for the caller.
   * @param {!Object} payload The object to return as JSON.
   * @returns {!GoogleAppsScript.Content.TextOutput} A JSON response.
   */
  static reply_(payload) {
    return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
  }

  /**
   * Installable onEdit handler: clearing a row's `parade_response_id` by hand
   * marks that parade state due for reprocessing, and this runs it.
   *
   * That gesture is the manual override — it is how a maintainer forces a re-run
   * after fixing a message, with no editor access needed. It also covers a row
   * pasted straight into the sheet, which `onFormSubmit` never sees.
   *
   * Runs on every edit anywhere in the spreadsheet, so it bails on the common
   * case in as few operations as possible. There is no feedback loop:
   * `processRow` finishes by writing the id back, and a script write does not
   * fire `onEdit`.
   * @param {!GoogleAppsScript.Events.SheetsOnEdit} e The edit event.
   * @returns {void}
   */
  static onEditHandler(e) {
    if (!e || !e.range) {
      return;
    }
    const sheet = e.range.getSheet();
    if (sheet.getName() !== SHEET_NAMES.RAW_RESPONSES) {
      return;
    }

    const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'parade_response_id');
    if (e.range.getColumn() > idCol || e.range.getLastColumn() < idCol) {
      return;
    }

    const firstRow = Math.max(e.range.getRow(), 2);
    const lastRow = e.range.getLastRow();
    const rowCount = lastRow - firstRow + 1;
    if (rowCount > MAX_ONEDIT_REPROCESS_ROWS) {
      Logger.log(
        `Parser.onEditHandler: ${rowCount} rows had parade_response_id cleared at once, above the ` +
          `${MAX_ONEDIT_REPROCESS_ROWS}-row limit. Nothing was reprocessed — each row costs an AI ` +
          'call, so clear them in smaller batches.'
      );
      return;
    }

    // Apps Script supplies oldValue only for a single-cell edit, which is exactly
    // the clear-one-id gesture; a multi-cell clear gives no old values at all.
    const previousId = rowCount === 1 && e.oldValue ? String(e.oldValue) : '';

    for (let rowIndex = firstRow; rowIndex <= lastRow; rowIndex++) {
      if (sheet.getRange(rowIndex, idCol).getValue() === '') {
        Parser.processRow(rowIndex, previousId);
      }
    }
  }

  /**
   * Installable onFormSubmit handler: runs the pipeline for the row the Form just
   * inserted.
   * @param {!GoogleAppsScript.Events.SheetsOnFormSubmit} e The form-submit event.
   * @returns {void}
   */
  static onFormSubmitHandler(e) {
    Parser.processRow(e.range.getRow(), '');
  }

  /**
   * Batch recovery for the Sheets menu: scans "Parade State Responses" and
   * reprocesses every row still due — `parade_response_id` blank, which includes a
   * row left mid-flight with PARADE_PROCESSING_SENTINEL in `error`. A real key
   * (success) or PARADE_ERROR_SENTINEL (a recorded failure) is left alone; an
   * ERROR row is recovered the existing way — fix the message, clear the id.
   *
   * Capped at MAX_ONEDIT_REPROCESS_ROWS matching rows, because each row costs an
   * AI call and the run shares the 6-minute execution limit. Above the cap nothing
   * is reprocessed and the reason is logged, mirroring `onEditHandler`.
   *
   * The scan runs bottom-up and re-reads each cell live rather than trusting a
   * pre-computed row list: `processRow` can delete a stale successful duplicate
   * (never a blank row), which shifts the rows above it. Walking downward and
   * re-reading means a shift only ever makes the cursor re-check an
   * already-processed slot, never skip a still-blank one.
   * @returns {void}
   */
  static reprocessPendingRows() {
    const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
    const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'parade_response_id');
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return;
    }

    const idValues = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    const dueCount = idValues.filter((row) => String(row[0]).trim() === '').length;
    if (dueCount === 0) {
      return;
    }
    if (dueCount > MAX_ONEDIT_REPROCESS_ROWS) {
      Logger.log(
        `Parser.reprocessPendingRows: ${dueCount} rows are still due, above the ` +
          `${MAX_ONEDIT_REPROCESS_ROWS}-row limit. Nothing was reprocessed — each row costs an AI ` +
          'call. Clear them in smaller batches, or raise the cap.'
      );
      return;
    }

    let processed = 0;
    for (let rowIndex = sheet.getLastRow(); rowIndex >= 2; rowIndex--) {
      if (String(sheet.getRange(rowIndex, idCol).getValue()).trim() === '') {
        Parser.processRow(rowIndex, '');
        processed += 1;
      }
    }
    Logger.log(`Parser.reprocessPendingRows: reprocessed ${processed} row(s).`);
  }

  /**
   * Installs both installable triggers on the bound spreadsheet: `onFormSubmit`
   * for the fallback Form path, and `onEdit` for the clear-the-id reprocess
   * gesture. Idempotent — removes existing copies first, so re-running never
   * creates duplicates.
   *
   * The WhatsApp intake needs no trigger; it arrives through the web app. The
   * `onEdit` trigger also drives `FormSgTimestamps.onEditHandler` — see
   * `src/WebApp.js`, which hosts the shared `onEditHandler` global.
   * @returns {void}
   */
  static installTriggers() {
    Parser.removeTriggers();
    const spreadsheet = SpreadsheetApp.getActive();
    ScriptApp.newTrigger('onFormSubmitHandler').forSpreadsheet(spreadsheet).onFormSubmit().create();
    ScriptApp.newTrigger('onEditHandler').forSpreadsheet(spreadsheet).onEdit().create();
    Logger.log(
      'Installed onFormSubmitHandler (Form fallback), onEditHandler (forced reprocess and FormSG ' +
        'timestamp repair).'
    );
  }

  /**
   * Removes any installed trigger pointing at this project's handlers.
   * @returns {void}
   */
  static removeTriggers() {
    const handlers = ['onFormSubmitHandler', 'onEditHandler'];
    ScriptApp.getProjectTriggers()
      .filter((trigger) => handlers.indexOf(trigger.getHandlerFunction()) !== -1)
      .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  }
}

/**
 * Global entry point required because ScriptApp trigger handlers must be a
 * top-level function name, not a class static method.
 * @param {!GoogleAppsScript.Events.SheetsOnFormSubmit} e The form-submit event.
 * @returns {void}
 */
function onFormSubmitHandler(e) {
  Parser.onFormSubmitHandler(e);
}

/**
 * Global entry point required because the Apps Script editor's function dropdown
 * only lists top-level functions, not class static methods.
 * @returns {void}
 */
function installTriggers() {
  Parser.installTriggers();
}

/**
 * Global entry point required because the Apps Script editor's function dropdown
 * only lists top-level functions, not class static methods.
 * @returns {void}
 */
function removeTriggers() {
  Parser.removeTriggers();
}

/**
 * Reprocesses one response row by its sheet row number, for driving a single row
 * by hand from the editor without touching the spreadsheet.
 * @param {number} rowIndex 1-based response row to reprocess.
 * @returns {void}
 */
function reprocessRow(rowIndex) {
  Parser.processRow(rowIndex, '');
}

/**
 * Global entry point for the "reprocessPendingRows" Sheets menu macro — macros
 * must be top-level functions, not class static methods, like `reprocessRow`.
 * @returns {void}
 */
function reprocessPendingRows() {
  Parser.reprocessPendingRows();
}
