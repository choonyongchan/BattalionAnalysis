/**
 * Spans of time on a date axis, one lane per kind: a soldier's MC and leave as bars, so the
 * gaps between episodes and their lengths read at a glance, which a table of dates hides.
 *
 * Each lane takes one step of the sequential ramp: the lanes are kinds, not companies, so no
 * company colour is spent on them. The table twin lists every span with its dates.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtDate, fmtInt } from '../format.js';
import { tooltipNode } from './tooltip.js';
import { axisOption, baseOption } from './theme.js';
import { MS_PER_DAY, isoToUtcMs } from '../../../shared/dates.js';

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { lanes, spans } = props;
  const base = baseOption(palette);
  const shades = [palette.seq[4], palette.seq[2], palette.seq[3], palette.seq[1]];
  return {
    ...base,
    grid: { ...base.grid, top: 8, bottom: 8 },
    tooltip: {
      ...base.tooltip,
      formatter: (params) => {
        const span = spans[params.dataIndex];
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
        renderItem: (params, api) => {
          const lane = api.value(0);
          const [x0, y] = api.coord([api.value(1), lane]);
          const [x1] = api.coord([api.value(2), lane]);
          const height = Math.min(18, api.size([0, 1])[1] * 0.6);
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

/**
 * A lane chart of date spans.
 * @param {{lanes: string[], spans: Array<{lane: string, start: string, end: string,
 *     days: number, label: (string|undefined)}>, height: (number|undefined),
 *     view: (string|undefined)}} props `lanes` top to bottom; each span names its lane and
 *     its inclusive ISO start and end; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Timeline(props) {
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
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when no span has both dates.
 */
Timeline.isEmpty = (props) => !props.spans || props.spans.length === 0;
