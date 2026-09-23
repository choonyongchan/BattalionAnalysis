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
 * The five companies the battalion tracks, in parade order. Scorpion is gone, as it is
 * from `companyEnum` in `db/schema.ts`.
 * @type {string[]}
 */
export const COMPANIES = ['Archer', 'Braves', 'Cougar', 'Stallion', 'Hercules'];

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
 * The company-level command roles every company files, in ORBAT order.
 * @type {string[]}
 */
export const COMMAND_ROLES = ['CDO', 'CDS', 'COS'];

/**
 * Each company's sub-units, in ORBAT order, as they follow `PDS` in a roster role.
 *
 * Numbering runs on across the rifle companies (Archer 1-3, Braves 4-6, Cougar 7-9), and
 * the support companies name theirs, so each company's PDS appointments differ.
 * @type {!Object<string, string[]>}
 */
export const COMPANY_SUBUNITS = {
  Archer: ['HQ', '1', '2', '3'],
  Braves: ['HQ', '4', '5', '6'],
  Cougar: ['HQ', '7', '8', '9'],
  Stallion: ['HQ', 'PNR', 'MTR', 'SCR', 'SIG'],
  Hercules: ['HQ', 'SIG', 'OPR+ASA', 'MED'],
};

/**
 * The columns of a company x platoon heatmap: a sub-unit's position within its company,
 * since the companies number and name their platoons differently. Position `i` is
 * `COMPANY_SUBUNITS[company][i]`.
 * @type {string[]}
 */
export const SUBUNIT_POSITIONS = ['Coy HQ', '1st Pl', '2nd Pl', '3rd Pl', '4th Pl'];

/**
 * Where a platoon sits among its company's sub-units.
 * @param {string} company Company name.
 * @param {*} platoon A platoon cell, e.g. `7`, `PNR` or `HQ`; case and spaces are ignored.
 * @returns {number} The index into `SUBUNIT_POSITIONS`, or -1 when the company has no such
 *     sub-unit.
 */
export function subunitPosition(company, platoon) {
  const text = String(platoon == null ? '' : platoon).toUpperCase().replace(/\s+/g, '');
  const unit = text === 'COYHQ' ? 'HQ' : text;
  return (COMPANY_SUBUNITS[company] || []).indexOf(unit);
}

/**
 * The roster roles one company files, in ORBAT order: the command roles, then a PDS per
 * sub-unit.
 * @param {string} company Company name.
 * @returns {string[]} Roles such as `CDO`, `PDSHQ`, `PDS7` or `PDSOPR+ASA`.
 */
export function commandRolesOf(company) {
  return [
    ...COMMAND_ROLES,
    ...(COMPANY_SUBUNITS[company] || [])
      .filter((unit) => unit !== 'HQ')
      .map((unit) => 'PDS' + unit),
  ];
}

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
