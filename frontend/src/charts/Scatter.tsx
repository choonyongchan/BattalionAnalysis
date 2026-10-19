/**
 * Two measures, one dot each (MCs against days lost), for a pattern a ranking hides. A dot wears its
 * company's colour and is translucent, so shared values show darker.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtInt } from '../format.ts';
import { tooltipLines } from './tooltip.ts';
import { baseOption, gridOption, seriesColor, valueAxisOption, type ChartOption, type Palette } from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';

/** One dot: its two counts, its name, its group (a company) and the group's colour slot. */
export interface ScatterPoint {
  x: number;
  y: number;
  label: string;
  group: string;
  slot: number;
}

/** A scatter plot's props. */
export interface ScatterProps extends ChartViewProps {
  points: ScatterPoint[];
  xName: string;
  yName: string;
  height?: number;
}

/** The ECharts option. */
function option(props: ScatterProps, palette: Palette): ChartOption {
  const { points, xName, yName } = props;
  const base = baseOption(palette);
  return {
    ...base,
    grid: gridOption(palette, true, { right: 24 }),
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params: { data: { point: ScatterPoint } }) => {
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

/** A scatter plot of two counts, or its table twin. */
export function Scatter(props: ScatterProps) {
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
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw. */
Scatter.isEmpty = (props: ScatterProps) => props.points.length === 0;
