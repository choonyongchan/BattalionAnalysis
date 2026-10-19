/**
 * The Today page's cards beyond the tiles: what other duties hold, which restrictions are in
 * force, presence by rank, who is away in the days ahead, who is due back, who is just back.
 */

import { Card, Coverage, EmptyState } from '../../components/Card.tsx';
import { DataTable } from '../../components/Table.tsx';
import { fmtDate, fmtInt, fmtPercent } from '../../format.ts';
import { Bar, ChartCard, Heatmap, Line } from '../../charts/index.ts';
import { COMPANIES } from '../../../../shared/domain.ts';
import { weekendBands } from '../../model/calendarMarks.ts';
import { otherDutiesOn } from '../../model/metrics.ts';
import { restrictionsOn } from '../../model/statusBuckets.ts';
import { tierPresence, type TierTotal } from '../../model/strength.ts';
import type { RestrictionCell } from '../../model/statusBuckets.ts';
import type { Dataset } from '../../data/feed.ts';
import type { StrengthRow } from '../../../../shared/dashboard.ts';
import { awayAhead, returnsToDuty } from '../../model/projection.ts';
import { recentlyReturned } from '../../model/recentReturns.ts';

/** Session every "today" figure describes. */
const SESSION = 'FPS';

/** Days the away-ahead chart covers. */
const AHEAD_DAYS = 14;

/** Names a restriction cell's tooltip lists before "and N more". */
const TOOLTIP_NAMES = 10;

/** What every card on the page reads: the scoped dataset and the parade date. */
type ParadeProps = { data: Dataset; date: string };

/** Other duties on one parade, by duty: the largest absence slice, broken open. */
export function OtherDutiesCard({ data, date }: ParadeProps) {
  const duties = otherDutiesOn(data.personnel, date, SESSION).slice(0, 8);
  return (
    <ChartCard
      title="Other Duties, by Duty"
      note={'The commonest duties under Others on the ' + fmtDate(date) + ' parade state'}
      empty="Nobody is listed under other duties."
    >
      <Bar categories={duties.map((duty) => duty.name)} values={duties.map((duty) => duty.value)} valueName="soldiers" />
    </ChartCard>
  );
}

/**
 * The restrictions in force on one parade, by company, with names in the tooltip: what a training plan has to
 * work around.
 */
export function RestrictionsCard({ data, date }: ParadeProps) {
  const { rows, cells } = restrictionsOn(data.personnel, date, SESSION);
  const detail = (cell: RestrictionCell) =>
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
        columns={[...COMPANIES]}
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

/** Soldiers already on MC or leave who are still away on each of the next days. */
export function AwayAheadCard({ data, date }: ParadeProps) {
  const { days, away } = awayAhead(returnsToDuty(data.personnel, date, SESSION), date, AHEAD_DAYS);
  return (
    <ChartCard
      title={'Known Away, Next ' + AHEAD_DAYS + ' Days'}
      coverage="A floor: only MC and leave on this parade with a stated end date. New MCs and open-ended absences add to it."
      empty={away.every((count) => count === 0) ? 'Nobody on this parade is away with a stated end date.' : undefined}
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

/** Formats one tier cell: the percentage present, then present over strength. */
function tierCell(tier: TierTotal): string {
  if (tier.strength === null) return '—';
  return `${fmtPercent(tier.percent === null ? null : tier.percent / 100)} (${fmtInt(tier.present)}/${fmtInt(tier.strength)})`;
}

/** Presence by rank tier on one parade: a row per company that filed, under a battalion row. */
export function TierCard({ strength, date, scoped }: { strength: StrengthRow[]; date: string; scoped: boolean }) {
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

/** The forward view: who is due back when, from the dates each MC and leave line states. */
export function ReturnsCard({ data, date }: ParadeProps) {
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

/** The backward twin of `ReturnsCard`: who came off MC or Light Duty just before this parade. */
export function RecentReturnsCard({ data, date }: ParadeProps) {
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
