/**
 * The duty tree for one company on one day: CDO at the top, CDS below, COS supporting
 * CDS, and PDS1 through PDS4 under CDS.
 *
 * Coverage in the real data is poor, and this module says so rather than drawing a
 * confident empty tree: Archer files a roster on 32 days, Stallion 29, Hercules 33 but
 * COS only, Cougar 3 rows in total, and Braves and Scorpion file none, ever. A company
 * that filed nothing renders as a single leaf saying so — that absence is the finding,
 * and hiding the company would hide it.
 *
 * Two company-days in the observed data carry 14 roster rows — the same company
 * submitting its roster twice. The later `parade_response_id` wins, the same rule the
 * parade-state pipeline uses everywhere else for a resubmission.
 *
 * Every function here is pure.
 */

import { COMMAND_ROLES, COMPANIES } from './domain.js';
import { toIsoDate, toText } from './values.js';

/** @type {string} What an unfilled role's node reads. */
const NOT_FILED = 'Not filed';

/** @type {string} The leaf label for a company with no roster on the date. */
const NO_ROSTER_LABEL = 'No roster filed';

/**
 * The roster rows for one company's parade, keeping only the latest submission.
 *
 * "Latest" is decided by `parade_response_id` sorting last among the ids present, which
 * holds because every id observed in the data embeds the same date and session and
 * differs only in an incrementing suffix when a company resubmits.
 * @param {Array<!Object>} rows Normalised Command Roster records.
 * @param {string} isoDate Parade date.
 * @param {string} company Company name.
 * @param {string} session Parade session.
 * @returns {Array<!Object>} The winning submission's rows, or [].
 */
function latestRosterRows_(rows, isoDate, company, session) {
  const matching = rows.filter(
    (row) =>
      toIsoDate(row.date) === isoDate &&
      toText(row.company) === company &&
      toText(row.session) === session
  );
  if (matching.length === 0) {
    return [];
  }
  const latestId = matching
    .map((row) => toText(row.parade_response_id))
    .sort()
    .pop();
  return matching.filter((row) => toText(row.parade_response_id) === latestId);
}

/**
 * One company's roster for one parade, every role present whether filed or not.
 * @param {Array<!Object>} rows Normalised Command Roster records.
 * @param {string} isoDate Parade date.
 * @param {string} company Company name.
 * @param {string=} session Parade session; defaults to 'FPS'.
 * @returns {Array<{role: string, rank: string, name: string, filed: boolean}>} One entry
 *     per role in COMMAND_ROLES order.
 */
export function rosterOn(rows, isoDate, company, session) {
  const targetSession = session || 'FPS';
  const byRole = new Map();
  latestRosterRows_(rows, isoDate, company, targetSession).forEach((row) => {
    const role = toText(row.role);
    if (COMMAND_ROLES.includes(role)) {
      byRole.set(role, { rank: toText(row.rank), name: toText(row.name) });
    }
  });

  return COMMAND_ROLES.map((role) => {
    const filled = byRole.get(role);
    return filled
      ? { role, rank: filled.rank, name: filled.name, filed: true }
      : { role, rank: '', name: '', filed: false };
  });
}

/**
 * Builds one node for a role.
 * @param {{role: string, rank: string, name: string, filed: boolean}} entry A roster row.
 * @param {Array<!Object>=} children The node's children.
 * @returns {!Object} A tree node.
 */
function roleNode_(entry, children) {
  return {
    name: entry.filed ? entry.rank + ' ' + entry.name : NOT_FILED,
    role: entry.role,
    rank: entry.rank,
    filed: entry.filed,
    children: children || [],
  };
}

/**
 * The command tree for one company's parade: CDO over CDS, COS beside CDS supporting it,
 * PDS1 through PDS4 under CDS.
 * @param {Array<!Object>} rows Normalised Command Roster records.
 * @param {string} isoDate Parade date.
 * @param {string} company Company name.
 * @param {string=} session Parade session; defaults to 'FPS'.
 * @returns {!Object} The company's tree, rooted at CDO.
 */
function companyTree_(rows, isoDate, company, session) {
  const roster = rosterOn(rows, isoDate, company, session);
  const byRole = new Map(roster.map((entry) => [entry.role, entry]));

  const platoons = ['PDS1', 'PDS2', 'PDS3', 'PDS4'].map((role) => roleNode_(byRole.get(role)));
  const cos = roleNode_(byRole.get('COS'));
  const cds = roleNode_(byRole.get('CDS'), [cos, ...platoons]);
  const cdo = roleNode_(byRole.get('CDO'), [cds]);

  return { name: company, role: 'COMPANY', filed: roster.some((entry) => entry.filed), children: [cdo] };
}

/**
 * The order-of-battle tree for one date: one company, or the whole battalion.
 *
 * Without `options.company`, the root is '40 SAR' with all six companies as children in
 * COMPANIES order — including the ones that filed nothing, which collapse to a single
 * leaf rather than a hollow command chain. That leaf is the point: a battalion-level view
 * that quietly omitted Braves and Scorpion would look complete and would not be.
 * @param {Array<!Object>} rows Normalised Command Roster records.
 * @param {string} isoDate Parade date.
 * @param {{company?: string, session?: string}=} options Restrict to one company, and/or
 *     name the session (defaults to 'FPS').
 * @returns {!Object} The tree.
 */
export function orbatTree(rows, isoDate, options) {
  const session = (options && options.session) || 'FPS';
  const company = options && options.company;

  if (company) {
    return companyTree_(rows, isoDate, company, session);
  }

  return {
    name: '40 SAR',
    role: 'BATTALION',
    filed: true,
    children: COMPANIES.map((name) => {
      const tree = companyTree_(rows, isoDate, name, session);
      return tree.filed ? tree : { name, role: 'COMPANY', filed: false, children: [{ name: NO_ROSTER_LABEL, role: 'NONE', filed: false, children: [] }] };
    }),
  };
}

/**
 * Which companies filed a roster on a date, and how many of the seven roles.
 * @param {Array<!Object>} rows Normalised Command Roster records.
 * @param {string} isoDate Parade date.
 * @param {string=} session Parade session; defaults to 'FPS'.
 * @returns {{companies: Array<{company: string, filed: boolean, roles: number}>,
 *     filedCount: number}} Per-company coverage, and how many companies filed anything.
 */
export function orbatCoverage(rows, isoDate, session) {
  const targetSession = session || 'FPS';
  const companies = COMPANIES.map((company) => {
    const roster = rosterOn(rows, isoDate, company, targetSession);
    const roles = roster.filter((entry) => entry.filed).length;
    return { company, filed: roles > 0, roles };
  });
  return { companies, filedCount: companies.filter((entry) => entry.filed).length };
}
