/**
 * Every Google Sheets read and write the parser performs.
 *
 * Each mutating method holds `LockService.getScriptLock()` for the shortest
 * possible span — never across a network call — and releases it in a `finally`,
 * so a stuck lock cannot wedge the whole system.
 */
class ParserSheets {
  /**
   * Acquires the script lock with a bounded wait, runs `work`, and releases the
   * lock even if `work` throws.
   * @param {function(): *} work Zero-arg function to run while holding the lock.
   * @param {number} [timeoutMs=5000] Max time to wait for the lock.
   * @returns {*} Whatever `work` returns.
   * @throws {Error} If the lock cannot be acquired in time, or if `work` throws.
   */
  static withLock_(work, timeoutMs) {
    const lock = LockService.getScriptLock();
    lock.waitLock(timeoutMs || 5000);
    try {
      return work();
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Reads one row's raw parade-state text, after checking the sheet's header.
   *
   * The header check is the guard that replaced a separate `verifySetup()` entry
   * point. "Parade State Responses" is Form-owned, so it is never created or
   * repaired here; but if its header does not match the expected columns then
   * every column index the parser computes is meaningless, and writing an error
   * into what we *believe* is the `error` column could overwrite real data. So a
   * mismatch logs the expected and actual header and writes nothing at all — the
   * log is the operator's instruction for fixing the columns by hand.
   *
   * Company/date/session are not read here: they live only as free text inside
   * the message, and are unknown until extraction.
   * @param {number} rowIndex 1-based sheet row to read.
   * @returns {?string} The raw text, or null when the header does not match.
   */
  static readText(rowIndex) {
    const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
    const header = sheet.getRange(1, 1, 1, RAW_RESPONSES_COLUMNS.length).getValues()[0];
    if (!RAW_RESPONSES_COLUMNS.every((column, i) => header[i] === column)) {
      Logger.log(
        `ParserSheets.readText: "${SHEET_NAMES.RAW_RESPONSES}" header does not match. ` +
          `Expected: ${RAW_RESPONSES_COLUMNS.join(' | ')}. Found: ${header.join(' | ')}. ` +
          'Nothing was read or written. Fix the sheet\'s columns to match, keeping the ' +
          'first two Form-owned columns as they are.'
      );
      return null;
    }

    const textCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'Drop your Parade State here');
    return String(sheet.getRange(rowIndex, textCol).getValue());
  }

  /**
   * Reads one row's persisted `parade_response_id`, trimmed.
   *
   * Lets `Parser.handlePost` tell a redelivered message whose row is still blank
   * (reprocess it — this covers the blank-id + PARADE_PROCESSING_SENTINEL case of
   * a run that never finished) from one already carrying a key or
   * PARADE_ERROR_SENTINEL (leave it alone). A single-cell read, so no lock, same
   * as `readText`'s value read.
   * @param {number} rowIndex 1-based sheet row.
   * @returns {string} The trimmed cell value; '' when blank.
   */
  static readParadeResponseId(rowIndex) {
    const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
    const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'parade_response_id');
    return String(sheet.getRange(rowIndex, idCol).getValue()).trim();
  }

  /**
   * Appends one row for a relayed WhatsApp message, unless its message id is
   * already recorded.
   *
   * This is what makes the `route=paradestate` endpoint idempotent. Two things
   * make dedup mandatory rather than defensive: Baileys can redeliver a message
   * after a reconnect, and an Apps Script web app answers through a 302 that a
   * client following redirects can turn into a second POST of the same body.
   * Either one would otherwise cost a duplicate row and a second AI extraction.
   *
   * The lock spans the read-then-append so two concurrent deliveries of the same
   * message cannot both decide the row is new.
   *
   * Only the Form-owned text column, the timestamp and `wa_message_id` are
   * filled; `parade_response_id` is left empty, which is exactly what marks the
   * row as due for processing.
   * @param {string} text The raw parade-state text.
   * @param {string} waMessageId Baileys message id, used as the dedup key.
   * @returns {{rowIndex: number, appended: boolean}} The row the message now
   *     occupies, and whether this call created it.
   * @throws {Error} If the script lock cannot be acquired (transient).
   */
  static appendIfNew(text, waMessageId) {
    return ParserSheets.withLock_(() => {
      const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
      const existingRowIndex = ParserSheets.findRowByWaMessageId_(sheet, waMessageId);
      if (existingRowIndex !== null) {
        return { rowIndex: existingRowIndex, appended: false };
      }
      sheet.appendRow(
        RAW_RESPONSES_COLUMNS.map((column) => {
          if (column === 'Timestamp') return new Date();
          if (column === 'Drop your Parade State here') return text;
          if (column === 'wa_message_id') return waMessageId;
          return '';
        })
      );
      return { rowIndex: sheet.getLastRow(), appended: true };
    }, 30000);
  }

  /**
   * Finds the row carrying a given WhatsApp message id.
   * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet The responses sheet.
   * @param {string} waMessageId The message id to look for.
   * @returns {?number} 1-based row index, or null if absent (or the id is empty).
   */
  static findRowByWaMessageId_(sheet, waMessageId) {
    if (!waMessageId) {
      return null;
    }
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return null;
    }
    const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'wa_message_id');
    const values = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
    for (let i = 0; i < values.length; i++) {
      if (String(values[i][0]) === waMessageId) {
        return i + 2;
      }
    }
    return null;
  }

  /**
   * Records a row's outcome: the key it processed to, or PARADE_ERROR_SENTINEL
   * plus the reason.
   *
   * Both cells are written in one `1x2` range so a row can never be seen with an
   * id from this run and an error from the last one. A script write does not fire
   * `onEdit`, so writing the id back here does not re-trigger processing.
   * @param {number} rowIndex 1-based sheet row to update.
   * @param {string} paradeResponseId The computed key, or PARADE_ERROR_SENTINEL.
   * @param {string} error The failure reason, or '' to clear it on success.
   * @returns {void}
   */
  static finishRow(rowIndex, paradeResponseId, error) {
    ParserSheets.withLock_(() => {
      const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
      const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'parade_response_id');
      sheet.getRange(rowIndex, idCol, 1, 2).setValues([[paradeResponseId, error]]);
    });
  }

  /**
   * Marks a row as mid-flight: blank `parade_response_id`, PARADE_PROCESSING_SENTINEL
   * in `error`, written as one `1x2` range under the script lock, mirroring
   * `finishRow`.
   *
   * `Parser.processRow` calls this before extraction, and `finishRow` overwrites
   * both cells at the end of every completed run, so the marker only persists when
   * the execution is killed between the two calls — which is exactly the state
   * that leaves a row stranded with a blank id.
   * @param {number} rowIndex 1-based sheet row to mark.
   * @returns {void}
   */
  static markProcessing(rowIndex) {
    ParserSheets.withLock_(() => {
      const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
      const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'parade_response_id');
      sheet.getRange(rowIndex, idCol, 1, 2).setValues([['', PARADE_PROCESSING_SENTINEL]]);
    });
  }

  /**
   * Deletes every other response row whose persisted `parade_response_id` equals
   * `paradeResponseId`, so at most one processed row exists per
   * company+date+session.
   *
   * Only rows that previously succeeded can match: a row at
   * PARADE_ERROR_SENTINEL or still unprocessed has no key and is left alone.
   * Iterates bottom-up so deleting a row never shifts the index of one not yet
   * visited.
   *
   * Returns how many of the deleted rows sat *above* `excludingRowIndex`, because
   * each one shifts that row up by one and the caller still has writes to make to
   * it. Without this the outcome would be written one row too low — silently, and
   * onto whatever submission happened to be there.
   * @param {string} paradeResponseId The key to match.
   * @param {number} excludingRowIndex The current row — never deleted.
   * @returns {number} How many deleted rows preceded `excludingRowIndex`.
   */
  static deleteDuplicateRawResponses_(paradeResponseId, excludingRowIndex) {
    return ParserSheets.withLock_(() => {
      const sheet = ParserSchema.sheet_(SHEET_NAMES.RAW_RESPONSES);
      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        return 0;
      }
      const numRows = lastRow - 1;
      const idCol = ParserSchema.columnIndex_(RAW_RESPONSES_COLUMNS, 'parade_response_id');
      const idValues = sheet.getRange(2, idCol, numRows, 1).getValues();

      let removedAbove = 0;
      for (let i = numRows - 1; i >= 0; i--) {
        const rowIndex = i + 2;
        if (rowIndex !== excludingRowIndex && idValues[i][0] === paradeResponseId) {
          sheet.deleteRow(rowIndex);
          if (rowIndex < excludingRowIndex) {
            removedAbove += 1;
          }
        }
      }
      return removedAbove;
    });
  }

  /**
   * Deletes every row in `sheet` whose value in `columnIndex` equals `value`.
   * Iterates bottom-up so deleting a row never shifts the index of one not yet
   * visited.
   * @param {!GoogleAppsScript.Spreadsheet.Sheet} sheet Sheet to delete from.
   * @param {number} columnIndex 1-based column index to match against.
   * @param {string} value Value to match for deletion.
   * @returns {void}
   */
  static deleteRowsWhereColumnEquals_(sheet, columnIndex, value) {
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return;
    }
    const numRows = lastRow - 1;
    const values = sheet.getRange(2, columnIndex, numRows, 1).getValues();
    for (let i = numRows - 1; i >= 0; i--) {
      if (values[i][0] === value) {
        sheet.deleteRow(i + 2);
      }
    }
  }

  /**
   * Deletes every previously-written output row for `paradeResponseId`, across
   * all three output tabs.
   *
   * Called before writing fresh output so the sheets stay consistent with "at
   * most one outcome per company+date+session", whether the submission is new,
   * a duplicate replacing an earlier one, or a forced reprocess.
   * @param {string} paradeResponseId The key to clear.
   * @returns {void}
   */
  static deleteOutputsForKey(paradeResponseId) {
    if (!paradeResponseId) {
      return;
    }
    ParserSheets.withLock_(() => {
      SCRIPT_OWNED_SHEETS.forEach((entry) => {
        const sheet = ParserSchema.sheet_(entry[0]);
        const columnIndex = ParserSchema.columnIndex_(entry[1], 'parade_response_id');
        ParserSheets.deleteRowsWhereColumnEquals_(sheet, columnIndex, paradeResponseId);
      });
    });
  }

  /**
   * Appends rows to one output tab.
   *
   * One method rather than three near-identical ones; the tab and its column
   * count come from SCRIPT_OWNED_SHEETS, so adding an output tab needs no new
   * write method.
   * @param {string} sheetName One of SHEET_NAMES.*.
   * @param {string[]} columns That sheet's column array.
   * @param {Array<Array<*>>} rows Row arrays in `columns` order.
   * @returns {void}
   */
  static appendRows(sheetName, columns, rows) {
    if (rows.length === 0) {
      return;
    }
    ParserSheets.withLock_(() => {
      const sheet = ParserSchema.sheet_(sheetName);
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, columns.length).setValues(rows);
    });
  }
}
