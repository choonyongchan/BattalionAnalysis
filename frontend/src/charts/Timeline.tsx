/**
 * Date spans on lanes, one lane per kind (a soldier's MC and leave), so gaps and lengths read at a glance.
 * Lanes are kinds, not companies, so they take the sequential ramp.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtDate, fmtInt } from '../format.ts';
import { tooltipNode } from './tooltip.ts';
import { axisOption, baseOption, type ChartOption, type Palette } from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';
import { MS_PER_DAY, isoToUtcMs } from '../../../shared/dates.ts';

/** One span on a lane, with inclusive ISO dates. */
export interface Span {
  lane: string;
  start: string;
  end: string;
  days: number;
  label?: string;
}

/** A lane chart's props; `lanes` run top to bottom. */
export interface TimelineProps extends ChartViewProps {
  lanes: string[];
  spans: Span[];
  height?: number;
}

/** What a custom series' renderItem gets to place a bar. */
type RenderApi = { value: (dimension: number) => number; coord: (value: number[]) => number[]; size: (value: number[]) => number[] };

/** The ECharts option. */
function option(props: TimelineProps, palette: Palette): ChartOption {
  const { lanes, spans } = props;
  const base = baseOption(palette);
  const shades = [palette.seq[4], palette.seq[2], palette.seq[3], palette.seq[1]];
  return {
    ...base,
    grid: { ...base.grid, top: 8, bottom: 8 },
    tooltip: {
      ...base.tooltip,
      formatter: (params: { dataIndex: number }) => {
        const span = spans[params.dataIndex]!;
        return tooltipNode(
          span.lane,
          [
            { label: 'From', value: fmtDate(span.start) },
            { label: 'To', value: fmtDate(span.end) },
            { label: 'Days', value: fmtInt(span.days) },
            ...(span.label ? [{ label: 'Reason', value: span.label }] : []),
          ],
          palette
        );
      },
    },
    xAxis: axisOption(palette, {
      type: 'time',
      splitLine: { show: true, lineStyle: { color: palette.hairlineSoft } },
      axisLabel: { color: palette.inkMuted, fontSize: 11, fontFamily: palette.fontUi, formatter: '{d} {MMM}', hideOverlap: true },
    }),
    yAxis: axisOption(palette, { type: 'category', data: lanes, splitLine: { show: false } }),
    series: [
      {
        type: 'custom',
        encode: { x: [1, 2], y: 0 },
        data: spans.map((span) => [
          lanes.indexOf(span.lane),
          isoToUtcMs(span.start),
          // The end date is a whole day: the bar runs to the end of it.
          isoToUtcMs(span.end) + MS_PER_DAY,
        ]),
        renderItem: (_params: unknown, api: RenderApi) => {
          const lane = api.value(0);
          const [x0 = 0, y = 0] = api.coord([api.value(1), lane]);
          const [x1 = 0] = api.coord([api.value(2), lane]);
          const height = Math.min(18, (api.size([0, 1])[1] ?? 0) * 0.6);
          return {
            type: 'rect',
            shape: { x: x0, y: y - height / 2, width: Math.max(2, x1 - x0), height, r: 3 },
            style: { fill: shades[lane % shades.length] },
          };
        },
      },
    ],
  };
}

/** A lane chart of date spans, or its table twin. */
export function Timeline(props: TimelineProps) {
  const { lanes, spans, height = 60 + 44 * lanes.length, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Kind' }, { label: 'From' }, { label: 'To' }, { label: 'Days', numeric: true }]}
        rows={spans.map((span) => [span.lane, fmtDate(span.start), fmtDate(span.end), fmtInt(span.days)])}
        caption="Spans by kind"
      />
    );
  }
  return (
    <Plot
      height={height}
      label={spans.length + ' spans across ' + lanes.length + ' kinds. Switch to Table for the dates.'}
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw. */
Timeline.isEmpty = (props: TimelineProps) => props.spans.length === 0;
