/**
 * Two measures of one thing, one dot each: for a pattern that a ranking of either measure
 * alone would hide, such as many short MCs against a few long ones.
 *
 * A dot that is a company's member takes that company's colour, as on every other chart.
 * Dots are translucent so soldiers sharing a value still show as a darker dot.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipLines } from './tooltip.js';
import { baseOption, gridOption, seriesColor, valueAxisOption } from './theme.js';

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { points, xName, yName } = props;
  const base = baseOption(palette);
  return {
    ...base,
    grid: gridOption(palette, true, { right: 24 }),
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params) => {
        const point = params.data.point;
        return tooltipLines(
          point.label,
          [point.group, xName + ': ' + fmtInt(point.x), yName + ': ' + fmtInt(point.y)],
          palette
        );
      },
    },
    xAxis: { ...valueAxisOption(palette, xName, false), minInterval: 1 },
    yAxis: { ...valueAxisOption(palette, yName, true), minInterval: 1 },
    series: [
      {
        type: 'scatter',
        symbolSize: 10,
        data: points.map((point) => ({
          value: [point.x, point.y],
          point,
          itemStyle: { color: seriesColor(palette, point.slot), opacity: 0.7 },
        })),
      },
    ],
  };
}

/**
 * A scatter plot of two counts.
 * @param {{points: Array<{x: number, y: number, label: string, group: string, slot: number}>,
 *     xName: string, yName: string, height: (number|undefined), view: (string|undefined)}}
 *     props One point per thing: its two counts, its name, its group (a company) and the
 *     group's colour slot; the axis names; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Scatter(props) {
  const { points, xName, yName, height = 340, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Name' }, { label: 'Company' }, { label: xName, numeric: true }, { label: yName, numeric: true }]}
        rows={points.map((point) => [point.label, point.group, fmtInt(point.x), fmtInt(point.y)])}
        caption={yName + ' against ' + xName}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={points.length + ' dots, ' + xName + ' across and ' + yName + ' up. Switch to Table for the values.'}
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
Scatter.isEmpty = (props) => !props.points || props.points.length === 0;
