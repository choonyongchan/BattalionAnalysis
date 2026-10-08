/**
 * The Today page's cards beyond the tiles: what other duties hold, which restrictions are in
 * force, presence by rank, who is away in the days ahead, who is due back, who is just back.
 */

import { Card, Coverage, EmptyState } from '../../components/Card.jsx';
import { DataTable } from '../../components/Table.jsx';
import { fmtDate, fmtInt, fmtPercent } from '../../format.js';
import { Bar, ChartCard, Heatmap, Line } from '../../charts/index.js';
import { COMPANIES } from '../../../../shared/domain.js';
import { weekendBands } from '../../model/calendarMarks.js';
import { otherDutiesOn } from '../../model/metrics.js';
import { restrictionsOn } from '../../model/statusBuckets.js';
import { tierPresence } from '../../model/strength.js';
import { awayAhead, returnsToDuty } from '../../model/projection.js';
import { recentlyReturned } from '../../model/recentReturns.js';

/** @type {string} Session every "today" figure describes. */
const SESSION = 'FPS';

/** @type {number} Days the away-ahead chart covers. */
const AHEAD_DAYS = 14;

/** @type {number} Names a restriction cell's tooltip lists before "and N more". */
const TOOLTIP_NAMES = 10;

/**
 * Other duties on one parade, by duty: the largest absence slice, broken open.
 * @param {{data: !Object, date: string}} props The scoped dataset and the parade date.
 * @returns {!preact.VNode} The card.
 */
export function OtherDutiesCard({ data, date }) {
  const duties = otherDutiesOn(data.personnel, date, SESSION).slice(0, 8);
  return (
    <ChartCard
      title="Other Duties, by Duty"
      note={'The commonest duties under Others on the ' + fmtDate(date) + ' parade state'}
      empty="Nobody is listed under other duties."
    >
      <Bar categories={duties.map((d) => d.name)} values={duties.map((d) => d.value)} valueName="soldiers" />
    </ChartCard>
  );
}

/**
 * The restrictions in force on one parade, by company, with names in the tooltip: what a
 * training plan has to work around.
 * @param {{data: !Object, date: string}} props The scoped dataset and the parade date.
 * @returns {!preact.VNode} The card.
 */
export function RestrictionsCard({ data, date }) {
  const { rows, cells } = restrictionsOn(data.personnel, date, SESSION);
  const detail = (cell) =>
    cell.names.length > TOOLTIP_NAMES
      ? [...cell.names.slice(0, TOOLTIP_NAMES), 'and ' + (cell.names.length - TOOLTIP_NAMES) + ' more']
      : cell.names;
  return (
    <ChartCard
      title="Restrictions in Force"
      note={'Soldiers on Status on the ' + fmtDate(date) + ' parade state, by what they are excused; one soldier can hold several'}
      empty="Nobody is on a restricting Status."
    >
      <Heatmap
        rows={rows}
        columns={COMPANIES}
        cells={cells}
        rowName="Restriction"
        valueName="soldiers"
        detail={detail}
        showValues
        height={Math.max(160, rows.length * 36 + 60)}
      />
    </ChartCard>
  );
}

/**
 * Soldiers already on MC or leave who are still away on each of the next days.
 * @param {{data: !Object, date: string}} props The scoped dataset and the parade date.
 * @returns {!preact.VNode} The card.
 */
export function AwayAheadCard({ data, date }) {
  const { days, away } = awayAhead(returnsToDuty(data.personnel, date, SESSION), date, AHEAD_DAYS);
  return (
    <ChartCard
      title={'Known Away, Next ' + AHEAD_DAYS + ' Days'}
      coverage="A floor: only MC and leave on this parade with a stated end date. New MCs and open-ended absences add to it."
      empty={away.every((n) => n === 0) ? 'Nobody on this parade is away with a stated end date.' : undefined}
    >
      <Line
        categories={days}
        series={[{ name: 'Away', values: away, neutral: true }]}
        weekends={weekendBands(days[0], days[days.length - 1])}
        valueName="soldiers"
      />
    </ChartCard>
  );
}

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
