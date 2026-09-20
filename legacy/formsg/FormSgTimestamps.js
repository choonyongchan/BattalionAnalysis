/**
 * Repairs text-shaped Timestamp cells left behind by a FormSG CSV import.
 *
 * Separate from FormSgSheet because it belongs to the other intake path: rows pasted
 * from FormSG's CSV export rather than relayed through Plumber. The webhook path
 * already writes real Dates.
 */
class FormSgTimestamps {
  /**
   * Installable onEdit handler: repairs a paste into the Timestamp column as it lands.
   *
   * FormSG's CSV export writes timestamps as "07 May 2026 19:21:00". Whether Google
   * Sheets parses that into a Date or leaves it as text depends on how the export was
   * pasted, which is why the column used to arrive half one and half the other. Real
   * Dates are canonical: they sort chronologically and read back as dates downstream.
   *
   * Scoped to the rows the edit actually touched, which keeps a full CSV re-paste cheap
   * and needs no follow-up step. Cells that are already Dates are left untouched, and
   * anything matching neither shape is reported rather than guessed at.
   * @param {!GoogleAppsScript.Events.SheetsOnEdit} e The edit event.
   * @returns {void}
   */
  static onEditHandler(e) {
    if (!e || !e.range) {
      return;
    }
    if (e.range.getSheet().getName() !== FORMSG_SHEET_NAME) {
      return;
    }

    const column = FormSgSchema.columnIndex(FORMSG_TIMESTAMP_HEADER);
    if (column === 0 || e.range.getColumn() > column || e.range.getLastColumn() < column) {
      return;
    }

    const firstRow = Math.max(e.range.getRow(), 2);
    const lastRow = e.range.getLastRow();
    if (lastRow < firstRow) {
      return;
    }

    const range = FormSgSchema.sheet().getRange(firstRow, column, lastRow - firstRow + 1, 1);
    const { converted, unparsed } = FormSgTimestamps.normaliseRange_(range);

    if (converted > 0 || unparsed.length > 0) {
      Logger.log(`FormSgTimestamps.onEditHandler: ${converted} converted, ${unparsed.length} unparsed.`);
      unparsed.forEach((entry) => Logger.log(`  unparsed — ${entry}`));
    }
  }

  /**
   * Rewrites text-shaped Timestamp cells within a range as real Date values.
   * @param {!GoogleAppsScript.Spreadsheet.Range} range A single-column range over the
   *     Timestamp column.
   * @returns {{converted: number, alreadyDates: number, unparsed: !Array<string>}} A
   *     summary of what the range held.
   * @private
   */
  static normaliseRange_(range) {
    const firstRow = range.getRow();
    const unparsed = [];
    let converted = 0;
    let alreadyDates = 0;

    const normalised = range.getValues().map((cells, i) => {
      const value = cells[0];
      if (value instanceof Date) {
        alreadyDates++;
        return [value];
      }
      if (value === '' || value === null || value === undefined) return [value];

      const parsed = FormSgTimestamps.parseCsvTimestamp_(String(value));
      if (!parsed) {
        unparsed.push(`row ${firstRow + i}: ${value}`);
        return [value];
      }
      converted++;
      return [parsed];
    });

    range.setValues(normalised);
    // The pasted column may carry plain-text formatting, which would render a Date as
    // a raw serial number. This format also matches FormSG's own CSV rendering.
    range.setNumberFormat('dd mmm yyyy hh:mm:ss');

    return { converted, alreadyDates, unparsed };
  }

  /**
   * Parses FormSG's CSV timestamp format, "dd MMM yyyy HH:mm:ss".
   *
   * Built explicitly rather than handed to `new Date(string)`, whose handling of
   * non-ISO formats is implementation-defined. The resulting Date is constructed in
   * the script's timezone (Asia/Singapore, per appsscript.json), which is the timezone
   * FormSG's export is already written in.
   *
   * @param {string} text The cell's text.
   * @returns {?Date} The parsed Date, or null if the text was not in that format.
   * @private
   */
  static parseCsvTimestamp_(text) {
    const match = /^\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*$/.exec(text);
    if (!match) return null;

    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthIndex = months.indexOf(match[2].toLowerCase());
    if (monthIndex === -1) return null;

    const parsed = new Date(
      Number(match[3]),
      monthIndex,
      Number(match[1]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6] || 0)
    );
    return isNaN(parsed.getTime()) ? null : parsed;
  }
}
