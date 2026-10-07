/**
 * Sheet-shaped test data, in the column order the Apps Script parser wrote.
 *
 * The parser that owned these layouts is retired, so the sheet layout is now frozen; the
 * columns are copied here from its last `ParserSchema.js` (see git history for `legacy/`).
 */

/** Column order of the "Personnel Data" tab. @type {!Array<string>} */
const PERSONNEL_DATA_COLUMNS = [
  'parade_response_id', 'date', 'session', 'company', 'platoon', 'four_d', 'name', 'rank',
  'reason_category', 'start_date', 'end_date', 'num_days', 'reason', 'location', 'in_camp',
];

/** Column order of the "Strength Data" tab. @type {!Array<string>} */
const STRENGTH_DATA_COLUMNS = [
  'parade_response_id', 'date', 'session', 'company', 'platoon', 'unit_type',
  'total_strength', 'total_present', 'officer_strength', 'officer_present',
  'wospec_strength', 'wospec_present', 'enlistee_strength', 'enlistee_present',
];

/**
 * Builds a Personnel Data values array from terse row specs.
 *
 * Builds the multi-day shapes episode grouping, weekday effects and repeat-absence tests
 * need, in the same column order as the real sheet.
 * @param {Array<!Object>} specs Partial rows; unset fields default to ''.
 * @returns {Array<Array<*>>} A values array including the header row.
 */
export function personnelValues(specs) {
  const columns = PERSONNEL_DATA_COLUMNS;
  const rows = specs.map((spec) => columns.map((column) => (column in spec ? spec[column] : '')));
  return [columns.slice(), ...rows];
}

/**
 * Builds a Strength Data values array from terse row specs.
 * @param {Array<!Object>} specs Partial rows; unset fields default to ''.
 * @returns {Array<Array<*>>} A values array including the header row.
 */
export function strengthValues(specs) {
  const columns = STRENGTH_DATA_COLUMNS;
  const rows = specs.map((spec) => columns.map((column) => (column in spec ? spec[column] : '')));
  return [columns.slice(), ...rows];
}
