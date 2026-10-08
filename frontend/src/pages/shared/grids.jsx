/**
 * Heatmap cards for the category pages: company by platoon, and reasons by period.
 */

import { useMemo, useState } from 'preact/hooks';
import { Segmented } from '../../components/Segmented.jsx';
import { fmtInt } from '../../format.js';
import { ChartCard, Heatmap } from '../../charts/index.js';
import { COMPANIES, SUBUNIT_POSITIONS, UNASSIGNED } from '../../../../shared/domain.js';
import { toPositionCells } from '../../model/platoon.js';
import { GRANULARITIES } from '../../model/buckets.js';
import { withinRange } from '../../model/dateRange.js';
import { topLabelsOverTime } from '../../model/reasonTrend.js';
import { toText } from '../../../../shared/values.js';
import { isDuty } from '../../model/classify.js';

/**
 * Counts episodes of one duty class — or several — per company x platoon for the heatmap grid.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string|!Array<string>} dutyClass Duty class(es) to keep, from DUTY_CLASS.
 * @returns {Array<{row: string, column: string, value: number}>} Non-empty cells, keyed by
 *     company and the platoon as written (`7`, `PNR`, or `UNASSIGNED` when blank);
 *     `PlatoonHeatmap` places them.
 */
export function episodeCells(episodes, dutyClass) {
  const counts = new Map();
  episodes
    .filter((episode) => isDuty(dutyClass, episode.dutyClass) && COMPANIES.includes(episode.company))
    .forEach((episode) => {
      const key = episode.company + '\u0000' + (toText(episode.platoon) || UNASSIGNED);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  return Array.from(counts, ([key, value]) => {
    const [row, column] = key.split('\u0000');
    return { row, column, value };
  });
}

/**
 * The Company x Platoon heatmap.
 *
 * The companies number and name their platoons differently (Archer 1-3, Cougar 7-9,
 * Stallion PNR/MTR/SCR/SIG), so the columns are a platoon's position within its company —
 * Coy HQ, then 1st to 4th Pl — and each cell is labelled with the company's own name for
 * Anything that fits no position is counted in the coverage line rather than drawn under
 * the wrong one.
 * @param {{cells: Array<{row: string, column: string, value: number}>, title?: string,
 *     coverage?: string, valueName?: string, empty?: string}} props The cells, keyed by
 *     company and platoon as written, from `episodeCells` or another source, and the
 *     card's wording.
 * @returns {!preact.VNode} The card.
 */
export function PlatoonHeatmap({
  cells,
  title = 'By Company and Platoon',
  coverage = 'Count of episodes; a bare platoon axis, not a rate — see the table for totals.',
  valueName = 'episodes',
  empty = 'No episodes in range to place on the grid.',
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
        rows={COMPANIES}
        columns={SUBUNIT_POSITIONS}
        cells={anything ? positioned.cells : []}
        valueName={valueName}
        height={340}
      />
    </ChartCard>
  );
}

/**
 * The top reasons over time, as a reason by period grid with its own granularity radio.
 *
 * A grid rather than grouped bars: five reasons across a month of days made thirty groups
 * of five slivers, a chart that grew taller with the range. A heatmap keeps one row per
 * reason at any range, and a hot cell is where a reason spiked.
 * @param {{rows: Array<!Object>, dateOf: function(!Object): ?string,
 *     labelsOf: function(!Object): string[], range: !Object, title?: string}} props The
 *     rows to chart, how to read each one's date and labels, and the range to keep.
 * @returns {!preact.VNode} The card.
 */
export function ReasonsOverTime({ rows, dateOf, labelsOf, range, title = 'Top Reasons Over Time' }) {
  const [granularity, setGranularity] = useState('daily');
  // `dateOf`/`labelsOf` are left out of the deps: pages pass fresh arrows each render
  // with the same meaning, and keying on them would recompute on every render.
  const trend = useMemo(() => {
    const items = rows
      .filter((row) => withinRange(dateOf(row), range.from, range.to))
      .map((row) => ({ date: dateOf(row), labels: labelsOf(row) }));
    return topLabelsOverTime(items, granularity, range.rotations, 5);
  }, [rows, range, granularity]);
  const cells = trend.series.flatMap((series) =>
    series.values.map((value, index) => ({ row: series.name, column: trend.categories[index], value }))
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
