/**
 * Self-Regulated Fitness Training: who trains, where, doing what and in how big a group, from the SFT form.
 * "Today" ignores the range: it answers who is out training now.
 */

import { useMemo } from 'preact/hooks';
import { company, dateFrom, dateTo, loadedData } from '../app/state.ts';
import { Card } from '../components/Card.tsx';
import { DataTable } from '../components/Table.tsx';
import { Tile, TileRow } from '../components/Tile.tsx';
import { Bar, ChartCard, Donut } from '../charts/index.ts';
import { companyIndex } from '../../../shared/domain.ts';
import { fmtDecimal, fmtInt } from '../format.ts';
import { isoToday, withinRange } from '../model/dateRange.ts';
import { onlyCompany } from '../model/scope.ts';
import {
  averageGroupSize,
  byCompany,
  groupSizeDistribution,
  groupSizes,
  soldierCount,
  toSftSessions,
  type GroupSize,
  type LabelCount,
  type SftSession,
  topExercises,
  topLocations,
} from '../model/sft.ts';
import { CategoryPage } from './shared/category.tsx';

/** How many locations and exercises each ranking shows. */
const TOP_N = 10;

/** The company-scoped SFT records and the active range. */
function useSft() {
  const full = loadedData();
  const all = useMemo(() => toSftSessions(full.sft), [full.sft]);
  const records = useMemo(() => onlyCompany(all, company.value), [all, company.value]);
  const dates = all.map((record) => record.date).sort();
  const min = dates[0] ?? isoToday();
  const max = dates[dates.length - 1] ?? isoToday();
  const range = { from: dateFrom.value || min, to: dateTo.value || max, min, max };
  return { records, range };
}

/** Sessions, soldiers, groups and mean group size per company. */
function CompanyBreakdown({ records, groups }: { records: SftSession[]; groups: GroupSize[] }) {
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

/** A ranked bar of labelled counts. */
function Ranking({ title, empty, rows, valueName }: { title: string; empty: string; rows: LabelCount[]; valueName: string }) {
  return (
    <ChartCard title={title} empty={empty}>
      <Bar categories={rows.map((row) => row.label)} values={rows.map((row) => row.count)} valueName={valueName} />
    </ChartCard>
  );
}

/** The SFT page. */
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
      <div class="grid-2">
        <ChartCard
          title="Soldiers Who Did SFT, by Company"
          coverage="Each company's share of the distinct soldiers who did SFT in range."
          empty="No SFT sessions in range."
        >
          <Donut
            slices={perCompany.map((row) => ({ name: row.company, value: row.soldiers, slot: companyIndex(row.company) }))}
            valueName="soldiers"
          />
        </ChartCard>
        <CompanyBreakdown records={ranged} groups={groups} />
      </div>
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
      <div class="grid-2">
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
      </div>
    </CategoryPage>
  );
}
