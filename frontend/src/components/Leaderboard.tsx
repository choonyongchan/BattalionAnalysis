/** A ranked table of soldiers, the shape every leaderboard shares. */

import { DataTable, type Column } from './Table.tsx';
import { fmtInt, fmtDecimal } from '../format.ts';
import type { RankedSoldier } from '../model/leaderboards.ts';

/** A leaderboard row: a ranked soldier, with day or status counts when the metric has them. */
export type LeaderboardRow = RankedSoldier & { days?: number; meanDays?: number; temporary?: number; permanent?: number };

/** The columns after name, company and platoon, per metric. */
const METRIC_COLUMNS: Record<'count' | 'days' | 'status', Column<object>[]> = {
  count: [{ key: 'count', label: 'Count', numeric: true }],
  days: [
    { key: 'count', label: '# MC', numeric: true },
    { key: 'days', label: 'Days away', numeric: true },
    { key: 'meanDays', label: 'Mean days', numeric: true },
  ],
  status: [
    { key: 'temporary', label: 'Temporary', numeric: true },
    { key: 'permanent', label: 'Permanent', numeric: true },
    { key: 'count', label: 'Total', numeric: true },
  ],
};

/** `leaderboards.ts` rows as a table; an inferred platoon wears the same hatch as on the heatmap. */
export function Leaderboard({ rows, metric }: { rows: LeaderboardRow[]; metric: 'count' | 'days' | 'status' }) {
  const columns: Column<object>[] = [
    { key: 'rank', label: '#', numeric: true },
    { key: 'name', label: 'Name' },
    { key: 'company', label: 'Company' },
    { key: 'platoon', label: 'Platoon' },
    ...METRIC_COLUMNS[metric],
  ];
  const displayRows = rows.map((row, index) => ({
    key: row.key,
    rank: index + 1,
    name: row.name,
    company: row.company,
    platoon: <span class={row.platoonInferred ? 'inferred' : ''}>{row.platoon}</span>,
    count: fmtInt(row.count),
    days: fmtInt(row.days),
    meanDays: fmtDecimal(row.meanDays),
    temporary: fmtInt(row.temporary),
    permanent: fmtInt(row.permanent),
  }));
  return <DataTable columns={columns} rows={displayRows} rowKey={(row) => row.key} />;
}
