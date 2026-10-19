/**
 * A trend over parade days, one line per company. `connectNulls` is false: most days lack a company, and
 * a line drawn across a day nobody filed asserts a reading never taken. Weekend bands and holiday rules
 * ride on a carrier series, so switching a company off in the legend never hides them.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtDate, fmtDayMonth, fmtInt } from '../format.ts';
import { tooltipNode } from './tooltip.ts';
import { axisOption, baseOption, legendOption, seriesColor, valueAxisOption, type ChartOption, type Palette } from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';
import type { Band } from '../model/calendarMarks.ts';
import type { Holiday } from '../../../shared/settings/defaults.ts';

/**
 * One line; a null value is a day not filed (a gap). `slot` fixes a company's colour, `neutral` draws a
 * battalion total in muted ink, `accent` a non-company series beside it.
 */
export interface LineSeries {
  name: string;
  values: (number | null)[];
  slot?: number;
  neutral?: boolean;
  accent?: boolean;
}

/** A trend's props; `categories` are ascending ISO dates, and annotations off the axis are dropped. */
export interface LineProps extends ChartViewProps {
  categories: string[];
  series: LineSeries[];
  valueName?: string;
  weekends?: Band[];
  holidays?: Holiday[];
  height?: number;
}

/** What an axis tooltip receives per series. */
type AxisPoint = { seriesName: string; axisValue: string; value: number | null | undefined; color: string };

/** Above this many points the symbols merge into a smear and come off. */
const SYMBOL_LIMIT = 45;

/** An annotation span clipped to the axis, or null where the axis has no column for it (never misplaced). */
function clipToAxis(fromIso: string, toIso: string, categories: string[]): Band | null {
  const from = categories.find((value) => value >= fromIso);
  const to = categories.filter((value) => value <= toIso).pop();
  return from !== undefined && to !== undefined && from <= to ? { from, to } : null;
}

/** The empty carrier series holding weekend bands and holiday rules, kept out of the legend. */
function annotationSeries(palette: Palette, weekends: Band[], holidays: Holiday[], categories: string[]): ChartOption {
  const bands = weekends
    .map((band) => clipToAxis(band.from, band.to, categories))
    .filter((band) => band !== null);
  const rules = holidays.filter((holiday) => categories.includes(holiday.date));

  return {
    type: 'line',
    name: ANNOTATION_SERIES,
    data: [],
    silent: true,
    legendHoverLink: false,
    markArea: {
      silent: true,
      itemStyle: { color: palette.weekendBand },
      data: bands.map((band, index) => [
        // Labelled once, on the leftmost band.
        {
          xAxis: band.from,
          name: 'Weekend',
          label: {
            show: index === 0,
            position: 'insideTop',
            color: palette.inkFaint,
            fontSize: 10,
          },
        },
        { xAxis: band.to },
      ]),
    },
    markLine: {
      silent: true,
      symbol: 'none',
      lineStyle: { color: palette.holidayLine, width: 1, type: 'solid' },
      label: {
        // Along the rule, so two holidays in one week do not overlap.
        rotate: 90,
        position: 'insideEndTop',
        distance: 4,
        color: palette.inkMuted,
        fontSize: 10,
        formatter: (params: { name: string }) => params.name,
      },
      data: rules.map((holiday) => ({ xAxis: holiday.date, name: holiday.name })),
    },
  };
}

/** The carrier series' name, kept out of the legend. */
const ANNOTATION_SERIES = '__annotations';

/** The ECharts option. */
function option(props: LineProps, palette: Palette): ChartOption {
  const { categories, series, valueName, weekends = [], holidays = [] } = props;
  const base = baseOption(palette);
  // Several coloured lines are named where they end, so nobody matches colours to a legend.
  const labelEnds = series.filter((entry) => !entry.neutral).length > 1;

  return {
    ...base,
    // Room on the right for the end labels that name each company's line.
    grid: { ...base.grid, top: 36, right: labelEnds ? 72 : base.grid.right },
    legend: legendOption(
      palette,
      series.map((entry) => entry.name),
    ),
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: palette.hairline } },
      formatter: (params: AxisPoint[]) => {
        const points = params.filter((point) => point.seriesName !== ANNOTATION_SERIES);
        return tooltipNode(
          points[0] ? fmtDate(points[0].axisValue) : '',
          points.map((point) => ({
            label: point.seriesName,
            value: point.value === null || point.value === undefined ? 'no filing' : fmtInt(point.value),
            color: point.color,
            muted: point.value === null || point.value === undefined,
          })),
          palette
        );
      },
    },
    // The end labels sit on the plot edges, so they are anchored inward to stay whole.
    xAxis: axisOption(palette, {
      type: 'category',
      data: categories,
      boundaryGap: false,
      splitLine: { show: false },
      axisLabel: {
        color: palette.inkMuted,
        fontSize: 11,
        fontFamily: palette.fontUi,
        alignMinLabel: 'left',
        alignMaxLabel: 'right',
        formatter: fmtDayMonth,
      },
    }),
    yAxis: valueAxisOption(palette, valueName, true),
    series: [
      annotationSeries(palette, weekends, holidays, categories),
      ...series.map((entry, index) => {
        const color = entry.neutral
          ? palette.inkMuted
          : entry.accent
            ? palette.accent
            : seriesColor(palette, entry.slot === undefined ? index : entry.slot);
        return {
          type: 'line',
          name: entry.name,
          data: entry.values,
          smooth: false,
          symbol: 'circle',
          symbolSize: 8,
          // Marks a reader can hover, until they touch.
          showSymbol: categories.length <= SYMBOL_LIMIT,
          // A 2px surface ring, so a marker stays legible where two series cross.
          itemStyle: { color, borderColor: palette.surface, borderWidth: 2 },
          lineStyle: { width: 2, color, cap: 'round', join: 'round' },
          // See the file header: a day nobody filed is a gap, not an interpolation.
          connectNulls: false,
          endLabel: { show: labelEnds, formatter: '{a}', color, fontSize: 11, fontFamily: palette.fontUi },
        };
      }),
    ],
  };
}

/** A multi-series trend with weekend and holiday annotations, or its table twin. */
export function Line(props: LineProps) {
  const { categories, series, valueName, height = 300, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[
          { label: 'Date' },
          ...series.map((entry) => ({ label: entry.name, numeric: true })),
        ]}
        rows={categories.map((category, index) => [
          fmtDate(category),
          ...series.map((entry) => fmtInt(entry.values[index])),
        ])}
        caption={valueName ? valueName + ' by day' : 'Values by day'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={`${valueName || 'Trend'} over ${categories.length} days, ${series.length} series. Switch to Table for the values.`}
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw; series of all nulls (companies that filed nothing) are not data. */
Line.isEmpty = (props: LineProps) =>
  props.categories.length === 0 || props.series.every((entry) => entry.values.every((value) => value === null));
