/**
 * A ranked table of soldiers, the shape every leaderboard in the dashboard shares.
 */

import { DataTable } from './Table.jsx';
import { fmtInt, fmtDecimal } from '../format.js';

/**
 * Marks a platoon cell as inferred, in the same hatch the heatmap uses for the same fact.
 * @param {string} platoon The platoon label.
 * @param {boolean} inferred Whether it was worked out from the 4D rather than stated.
 * @returns {!preact.VNode} The cell contents.
 */
function PlatoonCell({ platoon, inferred }) {
  return <span class={inferred ? 'inferred' : ''}>{platoon}</span>;
}

/**
 * Renders a leaderboard of `topByCount` / `topByDays` / `topByStatusCount` rows.
 * @param {{rows: Array<!Object>, metric: string}} props `rows` from `leaderboards.js`;
 *     `metric` is 'count' (a plain count column), 'days' (count + days + mean days), or
 *     'status' (temporary/permanent split).
 * @returns {!preact.VNode} The table.
 */
export function Leaderboard({ rows, metric }) {
  const base = [
    { key: 'rank', label: '#', numeric: true },
    { key: 'name', label: 'Name' },
    { key: 'fourD', label: '4D' },
    { key: 'company', label: 'Company' },
    { key: 'platoon', label: 'Platoon' },
  ];

  const metricColumns =
    metric === 'days'
      ? [
          { key: 'count', label: '# MC', numeric: true },
          { key: 'days', label: 'Days away', numeric: true },
          { key: 'meanDays', label: 'Mean days', numeric: true },
        ]
      : metric === 'status'
        ? [
            { key: 'temporary', label: 'Temporary', numeric: true },
            { key: 'permanent', label: 'Permanent', numeric: true },
            { key: 'count', label: 'Total', numeric: true },
          ]
        : [{ key: 'count', label: 'Count', numeric: true }];

  const displayRows = rows.map((row, index) => ({
    ...row,
    rank: index + 1,
    platoon: <PlatoonCell platoon={row.platoon} inferred={row.platoonInferred} />,
    count: fmtInt(row.count),
    days: fmtInt(row.days),
    meanDays: fmtDecimal(row.meanDays),
    temporary: fmtInt(row.temporary),
    permanent: fmtInt(row.permanent),
  }));

  return <DataTable columns={base.concat(metricColumns)} rows={displayRows} rowKey={(row) => row.key} />;
}
