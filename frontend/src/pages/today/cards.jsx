/**
 * The Today page's tables: presence by rank, who is due back, and who is just back.
 */

import { Card, Coverage, EmptyState } from '../../components/Card.jsx';
import { DataTable } from '../../components/Table.jsx';
import { fmtDate, fmtInt, fmtPercent } from '../../format.js';
import { tierPresence } from '../../model/strength.js';
import { returnsToDuty } from '../../model/projection.js';
import { recentlyReturned } from '../../model/recentReturns.js';

/** @type {string} Session every "today" figure describes. */
const SESSION = 'FPS';

/**
 * Formats one tier cell: the percentage present, then present over strength.
 * @param {{strength: ?number, present: ?number, percent: ?number}} tier A tier total.
 * @returns {string} e.g. '91% (111/122)', or '—' when the tier was not stated.
 */
function tierCell(tier) {
  if (tier.strength === null) {
    return '—';
  }
  return fmtPercent(tier.percent / 100) + ' (' + fmtInt(tier.present) + '/' + fmtInt(tier.strength) + ')';
}

/**
 * Presence by rank tier on one parade: a row per company that filed, under a battalion row.
 * @param {{strength: Array<!Object>, date: string, scoped: boolean}} props The scoped
 *     Strength Data, the parade date, and whether one company is selected (no battalion row).
 * @returns {!preact.VNode} The card.
 */
export function TierCard({ strength, date, scoped }) {
  const tiers = tierPresence(strength, date, SESSION);
  const rows = [
    ...(scoped ? [] : [{ unit: 'Battalion', tiers: tiers.battalion }]),
    ...tiers.byCompany.map((entry) => ({ unit: entry.company, tiers: entry.tiers })),
  ];

  return (
    <Card title="Presence by Rank" note="Officers, WOSpecs and enlistees present, as the parade state splits them">
      {tiers.byCompany.length === 0 ? (
        <EmptyState>No parade state filed for {fmtDate(date)}.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'unit', label: 'Unit' },
            { key: 'officer', label: 'Officers', numeric: true },
            { key: 'wospec', label: 'WOSpecs', numeric: true },
            { key: 'enlistee', label: 'Enlistees', numeric: true },
          ]}
          rows={rows.map((row) => ({
            unit: row.unit,
            ...Object.fromEntries(row.tiers.map((tier) => [tier.key, tierCell(tier)])),
          }))}
          rowKey={(row) => row.unit}
        />
      )}
      {tiers.companiesWithoutSplit.length > 0 ? (
        <Coverage>No rank split stated by {tiers.companiesWithoutSplit.join(', ')}.</Coverage>
      ) : null}
    </Card>
  );
}

/**
 * The forward view: who is due back when, from the dates each MC and leave line states.
 * @param {{data: !Object, date: string}} props The scoped dataset and the parade the
 *     absences are read from.
 * @returns {!preact.VNode} The card.
 */
export function ReturnsCard({ data, date }) {
  const returns = returnsToDuty(data.personnel, date, SESSION);

  return (
    <Card title="Returning to Duty" note="Everyone on MC or leave on this parade, soonest back first">
      {returns.length === 0 ? (
        <EmptyState>Nobody is listed on MC or leave on {fmtDate(date)}.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'company', label: 'Company' },
            { key: 'platoon', label: 'Platoon' },
            { key: 'category', label: 'Category' },
            { key: 'from', label: 'From' },
            { key: 'back', label: 'Back on' },
          ]}
          rows={returns.map((row) => ({
            ...row,
            name: (row.rank + ' ' + row.name).trim(),
            from: fmtDate(row.from),
            back: row.backOn ? fmtDate(row.backOn) : 'Not stated',
          }))}
          rowKey={(row) => row.company + row.key}
        />
      )}
    </Card>
  );
}

/**
 * The backward twin of `ReturnsCard`: who came off MC or Light Duty just before this parade.
 * @param {{data: !Object, date: string}} props The scoped dataset and the parade the list
 *     is counted back from.
 * @returns {!preact.VNode} The card.
 */
export function RecentReturnsCard({ data, date }) {
  const returns = recentlyReturned(data.personnel, date);

  return (
    <Card
      title="Recently Back"
      note={'Off MC in the last 2 days or Light Duty since yesterday, as of ' + fmtDate(date) + '; watch for relapse'}
    >
      {returns.length === 0 ? (
        <EmptyState>Nobody came off MC or Light Duty just before {fmtDate(date)}.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'company', label: 'Company' },
            { key: 'platoon', label: 'Platoon' },
            { key: 'kind', label: 'Type' },
            { key: 'reason', label: 'Reason' },
            { key: 'ended', label: 'Ended on' },
            { key: 'daysBack', label: 'Days back' },
          ]}
          rows={returns.map((row) => ({
            ...row,
            name: (row.rank + ' ' + row.name).trim(),
            ended: fmtDate(row.endedOn),
          }))}
          rowKey={(row) => row.kind + row.key}
        />
      )}
    </Card>
  );
}
