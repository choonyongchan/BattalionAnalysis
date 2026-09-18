/**
 * Parts of a whole over time: one column per day, split into named parts.
 *
 * Columns rather than bars here — unlike the rest of the bar family — because the category
 * axis is time, and time reads left to right. `horizontal` is available for the occasional
 * per-company breakdown, but the default is the time case.
 *
 * Used where both the height of a column and its internal mix matter: "how thin was the
 * battalion on Tuesday, and was the gap MC or duty" is one question, and splitting it
 * across two charts makes the reader hold one answer in their head while finding the
 * other. It is only honest where the parts genuinely sum to the column — a stack of
 * overlapping categories draws a total that does not exist.
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
  const { categories, series, valueName, horizontal = false } = props;
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
          params[0].axisValue,
          params
            // A zero part in a stack has no segment to point at, and listing it pushes the
            // parts that do exist off the bottom of a ten-row tooltip.
            .filter((point) => point.value > 0)
            .map((point) => ({
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
      stack: 'total',
      data: entry.values,
      barMaxWidth: 22,
      // A 1px surface hairline all round, so where two segments meet the reader sees a 2px
      // gap. The gap separates adjacent hues; a stroke in a visible colour would add
      // data-weight ink that is not data.
      itemStyle: {
        color: entry.neutral
          ? palette.inkMuted
          : seriesColor(palette, entry.slot === undefined ? index : entry.slot),
        borderColor: palette.surface,
        borderWidth: 1,
      },
    })),
  };
}

/**
 * A stacked bar chart of parts of a whole.
 * @param {{categories: string[],
 *     series: Array<{name: string, values: Array<?number>, slot: (number|undefined),
 *         neutral: (boolean|undefined)}>,
 *     valueName: (string|undefined), horizontal: (boolean|undefined),
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `categories` are normally ISO dates; each series carries one value per category;
 *     `slot` fixes a part's hue to its identity so a filter never repaints the rest;
 *     `neutral` draws a part in muted ink, for an "unaccounted" or "not recorded" slice
 *     that should not read as another category; `horizontal` defaults false — columns,
 *     because the axis is time; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function StackedBar(props) {
  const { categories, series, valueName, height = 300, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[
          { label: 'Period' },
          ...series.map((entry) => ({ label: entry.name, numeric: true })),
          { label: 'Total', numeric: true },
        ]}
        rows={categories.map((category, index) => [
          category,
          ...series.map((entry) => fmtInt(entry.values[index])),
          fmtInt(
            series.reduce(
              (sum, entry) => sum + (Number.isFinite(entry.values[index]) ? entry.values[index] : 0),
              0
            )
          ),
        ])}
        caption={valueName ? valueName + ' split by part' : 'Parts by period'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (valueName || 'Total') +
        ' split into ' +
        series.length +
        ' parts across ' +
        categories.length +
        ' periods. Switch to Table for the values.'
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
StackedBar.isEmpty = (props) =>
  !props.categories ||
  props.categories.length === 0 ||
  !props.series ||
  props.series.length === 0;
