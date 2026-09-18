/**
 * The battalion's own vocabulary, mirrored from `src/parser/ParserSchema.js`.
 *
 * The parser remains the single source of truth for what these values may be; the
 * dashboard keeps its own copy because it has to answer questions the data alone cannot
 * — "which companies have *not* reported yet" needs the full expected set, not the set
 * present in the rows. `test/dashboard/schema.test.js` asserts the two copies agree, so a
 * rename upstream breaks a test rather than a chart.
 */

/**
 * The six companies the battalion tracks, in parade order.
 * @type {string[]}
 */
export const COMPANIES = ['Archer', 'Braves', 'Cougar', 'Stallion', 'Scorpion', 'Hercules'];

/**
 * The platoons a per-platoon rate is drawn for.
 *
 * A company's Strength Data also carries a command element ("COMMANDERS") and its own
 * total row. Neither is a platoon, and putting them on a platoon axis produces columns
 * that cannot be compared with the rest. Rates are computed over this roll only, on both
 * sides of the fraction.
 * @type {string[]}
 */
export const PLATOONS = ['1', '2', '3', '4', 'HQ'];

/**
 * Allowed parade sessions: first parade of the day, and last.
 * @type {string[]}
 */
export const SESSIONS = ['FPS', 'LPS'];

/**
 * The `unit_type` marking a Strength Data row as a whole-company total.
 *
 * Battalion strength sums only these rows. Summing platoon rows instead would
 * double-count, and would silently drop companies that report no platoon breakdown.
 * @type {string}
 */
export const UNIT_TYPE_COMPANY = 'Company';

/**
 * The `reason_category` values the parser writes.
 * @type {string[]}
 */
export const REASON_CATEGORIES = ['Att C', 'Status', 'Off/Leave', 'Report Sick', 'MA', 'Others'];

/**
 * The command roles a Command Roster row may carry, in ORBAT order.
 * @type {string[]}
 */
export const COMMAND_ROLES = ['CDO', 'CDS', 'COS', 'PDS1', 'PDS2', 'PDS3', 'PDS4'];

/**
 * `num_days` sentinel a permanent status carries: "no expiry", not a duration.
 *
 * Mirrors `PERM_STATUS_NUM_DAYS` in `src/parser/ParserSchema.js`. Note that no row in the
 * observed data actually carries it — see `model/statusBuckets.js` for the fallback the
 * dashboard uses to recognise a permanent status.
 * @type {number}
 */
export const PERM_STATUS_NUM_DAYS = 999;

/**
 * Label used where a row names no platoon and none can be inferred.
 * @type {string}
 */
export const UNASSIGNED = 'Unassigned';
