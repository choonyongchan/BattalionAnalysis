/**
 * Turns a tab's raw `values[][]` into objects keyed by header name.
 *
 * Column position is not stable, so headers are resolved by name at read time and a
 * missing required header throws with the tab and header named. That failure is worth
 * being loud about: silently reading the wrong column produces a chart that looks
 * entirely plausible and is wrong.
 *
 * Every function here is pure.
 */

/**
 * Builds a header-name to column-index map, verifying every required header is present.
 * @param {Array<*>} headerRow Row 1 of the tab.
 * @param {string[]} required Headers the dashboard reads from this tab.
 * @param {string} tabName Tab name, used only in the error message.
 * @returns {!Object<string, number>} Header name to zero-based column index.
 * @throws {Error} If any required header is absent.
 */
export function indexHeaders(headerRow, required, tabName) {
  const header = (headerRow || []).map((cell) => String(cell == null ? '' : cell).trim());
  const index = {};
  header.forEach((name, position) => {
    if (name !== '' && !(name in index)) {
      index[name] = position;
    }
  });

  const missing = required.filter((name) => !(name in index));
  if (missing.length > 0) {
    const named = missing.map((name) => '"' + name + '"').join(', ');
    const noun = missing.length === 1 ? 'column' : 'columns';
    throw new Error(
      '"' + tabName + '" is missing ' + noun + ' ' + named +
        '. The tab layout changed, or the wrong tab was read.'
    );
  }
  return index;
}

/**
 * Maps a tab's data rows to plain objects keyed by header name.
 *
 * The Sheets API omits trailing empty cells, so a short row is not an error — every
 * requested header the row does not reach reads as ''.
 * @param {Array<Array<*>>} values The tab's values including the header row.
 * @param {string[]} required Headers to read.
 * @param {string} tabName Tab name, used only in error messages.
 * @returns {Array<!Object<string, *>>} One object per data row.
 * @throws {Error} If a required header is absent.
 */
export function toRecords(values, required, tabName) {
  const rows = values || [];
  if (rows.length === 0) {
    return [];
  }
  const index = indexHeaders(rows[0], required, tabName);
  return rows.slice(1).map((row) => {
    const record = {};
    required.forEach((name) => {
      const cell = row[index[name]];
      record[name] = cell === undefined || cell === null ? '' : cell;
    });
    return record;
  });
}
