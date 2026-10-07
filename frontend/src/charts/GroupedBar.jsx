/**
 * Two or more measures across the same categories, bars side by side.
 *
 * The report-sick reasons chart: ten symptom buckets on one axis, a bar per company or per
 * period beside each. Grouped rather than stacked because the question is "which of these
 * is bigger", and a stacked segment that does not start at a common baseline cannot be
 * compared by eye against its neighbour in the next group.
 *
 * Series take the categorical slots by identity, not by row order, so a legend click that
 * hides a company does not repaint the ones left behind. Past six series the ramp is out
 * of slots — fold the tail into an "Other" or facet, rather than letting a seventh wrap
 * onto slot one and read as the first.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipNode } from './tooltip.js';
import {
  axisOption,
  baseOption,
  gridOption,
  legendOption,
  seriesColor,
  valueAxisOption,
} from './theme.js';

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { categories, series, valueName, horizontal = true } = props;
  const base = baseOption(palette);
  const categoryAxis = axisOption(palette, {
    type: 'category',
    data: categories,
    splitLine: { show: false },
  });
  const valueAxis = valueAxisOption(palette, valueName, !horizontal);

  return {
    ...base,
    grid: gridOption(palette, horizontal && Boolean(valueName), { top: 36 }),
    legend: legendOption(
      palette,
      series.map((entry) => entry.name)
    ),
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params) =>
        tooltipNode(
          params[0].name,
          params.map((point) => ({
            label: point.seriesName,
            value: fmtInt(point.value),
            color: point.color,
          })),
          palette
        ),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: series.map((entry, index) => ({
      type: 'bar',
      name: entry.name,
      data: entry.values,
      barMaxWidth: 14,
      // A 1px surface hairline on every side, which reads as a 2px gap where two bars
      // touch. The gap is what keeps two adjacent hues separable for a reader who cannot
      // tell them apart, without spending a third channel on it.
      itemStyle: {
        color: entry.neutral
          ? palette.inkMuted
          : seriesColor(palette, entry.slot === undefined ? index : entry.slot),
        borderColor: palette.surface,
        borderWidth: 1,
        borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
      },
    })),
  };
}

/**
 * A grouped bar chart with a toggling legend.
 * @param {{categories: string[],
 *     series: Array<{name: string, values: Array<?number>, slot: (number|undefined),
 *         neutral: (boolean|undefined)}>,
 *     valueName: (string|undefined), horizontal: (boolean|undefined),
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `categories` label the groups; each series carries one value per category, in the
 *     same order; `slot` fixes a series' hue to its identity (a company: pass
 *     `COMPANIES.indexOf(name)`); `neutral` draws a series in muted ink, for a total or a
 *     baseline; `horizontal` defaults true; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function GroupedBar(props) {
  const { categories, series, valueName, height = 320, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[
          { label: 'Category' },
          ...series.map((entry) => ({ label: entry.name, numeric: true })),
        ]}
        rows={categories.map((category, index) => [
          category,
          ...series.map((entry) => fmtInt(entry.values[index])),
        ])}
        caption={valueName ? valueName + ' by category and series' : 'Values by category'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        series.length +
        ' series across ' +
        categories.length +
        ' categories. Switch to Table for the values.'
      }
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
GroupedBar.isEmpty = (props) =>
  !props.categories ||
  props.categories.length === 0 ||
  !props.series ||
  props.series.length === 0;
