/**
 * When in the day soldiers report sick.
 *
 * Columns rather than bars, and not merely by convention: the bins are ordered — 07:00 sits
 * before 08:00 and nowhere else — and a distribution read left to right along the clock is
 * a shape a reader recognises, where the same numbers on a vertical axis are a list.
 *
 * The weekday/weekend split is optional because it answers a different question from the
 * one the plain distribution answers, and only one of the two should be on screen at a
 * time. Split, the two series are drawn side by side rather than stacked: the question is
 * "does the weekend peak later", which is a comparison of two shapes, and a stacked
 * segment that does not start at the baseline cannot be compared against its neighbour by
 * eye.
 *
 * The bins themselves are the model's business. This component does not decide bucket
 * width, does not drop empty bins, and does not sort — a histogram whose empty bins were
 * removed would draw a continuous distribution over a gap in time.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipNode } from './tooltip.js';
import { axisOption, baseOption, legendOption, seriesColor, valueAxisOption } from './theme.js';

/** @type {string} The legend and column name for the weekday half of a split. */
const WEEKDAY = 'Weekday';

/** @type {string} The legend and column name for the weekend half of a split. */
const WEEKEND = 'Weekend';

/**
 * The series drawn, in slot order.
 * @param {!Object} props The component's props.
 * @returns {Array<{name: string, read: function(!Object): ?number, slot: number}>} One
 *     entry per series, each knowing how to read its value off a bin.
 */
function seriesFor_(props) {
  return props.split
    ? [
        { name: WEEKDAY, read: (bin) => bin.weekday, slot: 0 },
        { name: WEEKEND, read: (bin) => bin.weekend, slot: 1 },
      ]
    : [{ name: props.valueName || 'Submissions', read: (bin) => bin.count, slot: 0 }];
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { bins, valueName } = props;
  const series = seriesFor_(props);
  const base = baseOption(palette);

  return {
    ...base,
    grid: { ...base.grid, top: 36 },
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
          params.map((point) => ({
            label: point.seriesName,
            value: fmtInt(point.value),
            color: point.color,
          })),
          palette
        ),
    },
    xAxis: axisOption(palette, {
      type: 'category',
      data: bins.map((bin) => bin.label),
      splitLine: { show: false },
      // Every bin labelled: a distribution with a third of its clock times hidden cannot be
      // read off the axis, and the bins are short enough (`07:00`) to all fit.
      axisLabel: { color: palette.inkMuted, fontSize: 11, fontFamily: palette.fontUi, interval: 'auto' },
    }),
    yAxis: valueAxisOption(palette, valueName, true),
    series: series.map((entry) => ({
      type: 'bar',
      name: entry.name,
      data: bins.map((bin) => entry.read(bin) ?? 0),
      // Columns close together, the way a histogram's are, but never touching: the 1px
      // surface hairline leaves a 2px gap where two meet.
      barCategoryGap: '18%',
      itemStyle: {
        color: seriesColor(palette, entry.slot),
        borderColor: palette.surface,
        borderWidth: 1,
        borderRadius: [4, 4, 0, 0],
      },
    })),
  };
}

/**
 * A time-of-day distribution.
 * @param {{bins: Array<{label: string, count: (number|undefined),
 *         weekday: (number|undefined), weekend: (number|undefined)}>,
 *     split: (boolean|undefined), valueName: (string|undefined),
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `bins` are already bucketed and in clock order, empty bins included; each carries
 *     `count`, and additionally `weekday` and `weekend` when the caller intends to offer
 *     the split; `split` chooses which of the two is drawn; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Histogram(props) {
  const { bins, valueName, height = 280, view } = props;
  if (view === 'table') {
    const series = seriesFor_(props);
    return (
      <TableTwin
        columns={[{ label: 'Time' }, ...series.map((entry) => ({ label: entry.name, numeric: true }))]}
        rows={bins.map((bin) => [bin.label, ...series.map((entry) => fmtInt(entry.read(bin) ?? 0))])}
        caption={(valueName || 'Submissions') + ' by time of day'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (valueName || 'Submissions') +
        ' across ' +
        bins.length +
        ' time-of-day bins. Switch to Table for the values.'
      }
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 *
 * A row of empty bins is not a distribution; it is a window in which nobody reported sick,
 * and the card should say that in words.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
Histogram.isEmpty = (props) =>
  !props.bins ||
  props.bins.length === 0 ||
  seriesFor_(props).every((entry) => props.bins.every((bin) => !(entry.read(bin) > 0)));
