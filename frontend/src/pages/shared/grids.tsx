/**
 * Heatmap cards for the category pages: company by platoon, and reasons by period.
 */

import { useMemo, useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.tsx';
import { fmtInt } from '../../format.ts';
import { ChartCard, Heatmap } from '../../charts/index.ts';
import { COMPANIES, SUBUNIT_POSITIONS, UNASSIGNED, isCompany } from '../../../../shared/domain.ts';
import { toPositionCells, type PlatoonCell } from '../../model/platoon.ts';
import { GRANULARITIES, type Granularity } from '../../model/buckets.ts';
import { withinRange } from '../../model/dateRange.ts';
import { topLabelsOverTime } from '../../model/reasonTrend.ts';
import { toText } from '../../../../shared/values.ts';
import { isDuty } from '../../model/classify.ts';
import type { Episode } from '../../model/episodes.ts';
import type { DutyFilter } from '../../model/metrics.ts';
import type { CategoryRange } from './category.tsx';

/** Counts episodes of one duty class — or several — per company x platoon for the heatmap grid. */
export function episodeCells(episodes: Episode[], dutyClass: DutyFilter): PlatoonCell[] {
  const counts = new Map<string, number>();
  for (const episode of episodes) {
    if (!isDuty(dutyClass, episode.dutyClass) || !isCompany(episode.company)) continue;
    const key = episode.company + '\u0000' + (toText(episode.platoon) || UNASSIGNED);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([key, value]) => {
    const [row = '', column = ''] = key.split('\u0000');
    return { row, column, value };
  });
}

/** The Company x Platoon heatmap. */
export function PlatoonHeatmap({
  cells,
  title = 'By Company and Platoon',
  coverage = 'Count of episodes; a bare platoon axis, not a rate — see the table for totals.',
  valueName = 'episodes',
  empty = 'No episodes in range to place on the grid.',
}: {
  cells: PlatoonCell[];
  title?: string;
  coverage?: string;
  valueName?: string;
  empty?: string;
}) {
  const positioned = toPositionCells(cells);
  const anything = positioned.cells.some((cell) => cell.value > 0);
  const note =
    positioned.unplaced > 0
      ? coverage + ' ' + fmtInt(positioned.unplaced) + ' ' + valueName + ' named no platoon of their company and are not drawn.'
      : coverage;
  return (
    <ChartCard title={title} coverage={note} empty={empty}>
      <Heatmap
        rows={[...COMPANIES]}
        columns={SUBUNIT_POSITIONS}
        cells={anything ? positioned.cells : []}
        valueName={valueName}
        height={340}
      />
    </ChartCard>
  );
}

/** The top reasons over time, as a reason by period grid with its own granularity radio. */
export function ReasonsOverTime<T>({
  rows,
  dateOf,
  labelsOf,
  range,
  title = 'Top Reasons Over Time',
}: {
  rows: T[];
  dateOf: (row: T) => string | null;
  labelsOf: (row: T) => string[];
  range: CategoryRange;
  title?: string;
}) {
  const [granularity, setGranularity] = useState<Granularity>('daily');
  // `dateOf`/`labelsOf` are left out of the deps: pages pass fresh arrows each render
  // with the same meaning, and keying on them would recompute on every render.
  const trend = useMemo(() => {
    const items = rows
      .filter((row) => withinRange(dateOf(row), range.from, range.to))
      .map((row) => ({ date: dateOf(row), labels: labelsOf(row) }));
    return topLabelsOverTime(items, granularity, range.rotations, 5);
  }, [rows, range, granularity]);
  const cells = trend.series.flatMap((series) =>
    series.values.map((value, index) => ({ row: series.name, column: trend.categories[index]!, value }))
  );

  return (
    <ChartCard
      title={title}
      coverage="Count of soldiers giving each reason; the five commonest in range, the rest under Other."
      empty="No reasons recorded in range."
      controls={
        <Segmented options={GRANULARITIES} value={granularity} onChange={setGranularity} label="Group dates by" radio />
      }
    >
      <Heatmap
        rows={trend.series.map((series) => series.name)}
        columns={trend.categories}
        cells={cells.filter((cell) => cell.value > 0)}
        valueName="soldiers"
        showValues={trend.categories.length <= 14}
        height={80 + 40 * trend.series.length}
      />
    </ChartCard>
  );
}
