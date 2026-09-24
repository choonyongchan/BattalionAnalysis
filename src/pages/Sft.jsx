/**
 * Self-Regulated Fitness Training: who is training on their own time, where, doing what, and
 * in how big a group.
 *
 * Read from the SFT FormSG form (`sft_formsg`), one row per session filed. The company and
 * date bar work as on every other page; "today" ignores the range, since it answers a
 * different question — who is out training now.
 */

import { useMemo } from 'preact/hooks';
import { company, dataset, dateFrom, dateTo } from '../app/state.js';
import { Card } from '../components/Card.jsx';
import { DataTable } from '../components/Table.jsx';
import { Tile, TileRow } from '../components/Tile.jsx';
import { Bar, ChartCard } from '../charts/index.js';
import { fmtDecimal, fmtInt } from '../format.js';
import { isoToday, withinRange } from '../model/dateRange.js';
import { scopeSubmissions } from '../model/scope.js';
import {
  averageGroupSize,
  byCompany,
  groupSizeDistribution,
  groupSizes,
  soldierCount,
  toSftRecords,
  topExercises,
  topLocations,
} from '../model/sft.js';
import { CategoryPage } from './shared/category.jsx';

/** @type {number} How many locations and exercises each ranking shows. */
const TOP_N = 10;

/**
 * The company-scoped SFT records and the active range.
 *
 * The range bounds are the full, unscoped SFT dates, so the picker does not contract when a
 * company with fewer sessions is picked.
 * @returns {{records: Array<!Object>, range: {from: string, to: string, min: string, max: string}}}
 *     Scoped records, and the range.
 */
function useSft() {
  const full = dataset.value;
  const all = useMemo(() => toSftRecords(full.sft), [full.sft]);
  const records = useMemo(() => scopeSubmissions(all, company.value), [all, company.value]);
  const dates = all.map((record) => record.date).sort();
  const min = dates[0] || isoToday();
  const max = dates[dates.length - 1] || isoToday();
  const range = { from: dateFrom.value || min, to: dateTo.value || max, min, max };
  return { records, range };
}

/**
 * Sessions, soldiers, groups and mean group size per company.
 * @param {{records: Array<!Object>, groups: Array<!Object>}} props In-range records and their groups.
 * @returns {!preact.VNode} The card.
 */
function CompanyBreakdown({ records, groups }) {
  const rows = byCompany(records).map((row) => {
    const mine = groups.filter((group) => group.company === row.company);
    return {
      ...row,
      groups: mine.length,
      average: fmtDecimal(averageGroupSize(mine)),
      sessions: fmtInt(row.sessions),
      soldiers: fmtInt(row.soldiers),
    };
  });
  return (
    <Card title="SFT by Company">
      <DataTable
        columns={[
          { key: 'company', label: 'Company' },
          { key: 'soldiers', label: 'Soldiers', numeric: true },
          { key: 'sessions', label: 'Sessions', numeric: true },
          { key: 'groups', label: 'Groups', numeric: true },
          { key: 'average', label: 'Avg Group Size', numeric: true },
        ]}
        rows={rows}
        rowKey={(row) => row.company}
      />
    </Card>
  );
}

/**
 * A ranked bar of labelled counts.
 * @param {{title: string, empty: string, rows: Array<{label: string, count: number}>,
 *     valueName: string}} props The card title, its empty message, the ranking, and the unit.
 * @returns {!preact.VNode} The card.
 */
function Ranking({ title, empty, rows, valueName }) {
  return (
    <ChartCard title={title} empty={empty}>
      <Bar categories={rows.map((row) => row.label)} values={rows.map((row) => row.count)} valueName={valueName} />
    </ChartCard>
  );
}

/**
 * The SFT page.
 * @returns {!preact.VNode} The page.
 */
export function Sft() {
  const { records, range } = useSft();
  const ranged = records.filter((record) => withinRange(record.date, range.from, range.to));
  const today = isoToday();
  const groups = groupSizes(ranged);
  const perCompany = byCompany(ranged);
  const distribution = groupSizeDistribution(groups);

  return (
    <CategoryPage title="Self-Regulated Fitness Training" range={range}>
      <TileRow>
        <Tile label="Soldiers Did SFT" value={fmtInt(soldierCount(ranged))} />
        <Tile label="SFT Sessions" value={fmtInt(ranged.length)} />
        <Tile
          label="Soldiers Did SFT Today"
          value={fmtInt(soldierCount(records.filter((record) => record.date === today)))}
        />
        <Tile
          label="Average Group Size"
          value={fmtDecimal(averageGroupSize(groups))}
          foot={fmtInt(groups.length) + ' groups, IC included'}
        />
      </TileRow>
      <ChartCard title="Soldiers Did SFT — by Company" empty="No SFT sessions in range.">
        <Bar
          categories={perCompany.map((row) => row.company)}
          values={perCompany.map((row) => row.soldiers)}
          valueName="soldiers"
        />
      </ChartCard>
      <CompanyBreakdown records={ranged} groups={groups} />
      <ChartCard
        title="Group Size"
        coverage="A group is everyone naming the same Group IC on one day; IC names are fuzzy-matched, and the IC is counted in the group."
        empty="No sessions in range named a Group IC."
      >
        <Bar
          categories={distribution.map((row) => String(row.size))}
          values={distribution.map((row) => row.count)}
          valueName="groups"
          horizontal={false}
        />
      </ChartCard>
      <Ranking
        title="Common SFT Locations"
        empty="No locations recorded in range."
        rows={topLocations(ranged, TOP_N)}
        valueName="sessions"
      />
      <Ranking
        title="Common Exercises"
        empty="No exercises recorded in range."
        rows={topExercises(ranged, TOP_N)}
        valueName="sessions"
      />
    </CategoryPage>
  );
}
