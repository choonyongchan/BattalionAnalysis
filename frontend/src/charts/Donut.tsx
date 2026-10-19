/**
 * Parts of one whole, as a ring, for five or six parts only (more is a bar). Colour follows identity: a
 * company slice wears its slot, other parts the sequential ramp, a `neutral` majority the sunken tone.
 * Every slice is labelled on the ring, so nobody matches colours to a legend.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtInt, fmtPercent } from '../format.ts';
import { tooltipNode } from './tooltip.ts';
import { baseOption, seriesColor, type ChartOption, type Palette } from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';

/** One part of the whole; `slot` fixes a company's colour, `neutral` mutes the majority part. */
export interface Slice {
  name: string;
  value: number;
  slot?: number;
  neutral?: boolean;
}

/** A donut's props; slices are drawn clockwise from twelve. */
export interface DonutProps extends ChartViewProps {
  slices: Slice[];
  valueName?: string;
  height?: number;
}

/** What an item tooltip or label receives. */
type ItemParam = { name: string; value: number; color: string };

/** The colour each slice wears, in drawing order. */
function colours(slices: Slice[], palette: Palette): string[] {
  const ranked = slices
    .map((slice, index) => ({ index, value: slice.value }))
    .filter(({ index }) => slices[index]!.slot === undefined && !slices[index]!.neutral)
    .sort((a, b) => b.value - a.value);
  const ramp = palette.seq.slice().reverse();
  const shade = new Map(ranked.map(({ index }, rank) => [index, ramp[Math.min(rank, ramp.length - 1)]]));
  return slices.map((slice, index) =>
    slice.neutral ? palette.canvasSunken : slice.slot !== undefined ? seriesColor(palette, slice.slot) : shade.get(index)!,
  );
}

/** The ECharts option. */
function option(props: DonutProps, palette: Palette): ChartOption {
  const { slices, valueName } = props;
  const base = baseOption(palette);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const sliceColours = colours(slices, palette);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params: ItemParam) =>
        tooltipNode(
          params.name,
          [{ label: valueName || 'Count', value: fmtInt(params.value) + ' (' + fmtPercent(params.value / total) + ')', color: params.color }],
          palette
        ),
    },
    series: [
      {
        type: 'pie',
        radius: ['44%', '66%'],
        center: ['50%', '52%'],
        avoidLabelOverlap: true,
        minShowLabelAngle: 2,
        itemStyle: { borderColor: palette.surface, borderWidth: 2 },
        label: {
          color: palette.ink,
          fontFamily: palette.fontUi,
          fontSize: 12,
          formatter: (params: ItemParam) => params.name + '\n' + fmtInt(params.value) + ' (' + fmtPercent(params.value / total) + ')',
        },
        labelLine: { length: 14, length2: 12, lineStyle: { color: palette.hairline } },
        data: slices.map((slice, index) => ({ slice, index })).filter(({ slice }) => slice.value > 0).map(({ slice, index }) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: sliceColours[index] },
        })),
      },
    ],
  };
}

/** A donut of parts of one whole, or its table twin. */
export function Donut(props: DonutProps) {
  const { slices, valueName, height = 280, view } = props;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Part' }, { label: valueName || 'Count', numeric: true }, { label: 'Share', numeric: true }]}
        rows={slices.map((slice) => [slice.name, fmtInt(slice.value), fmtPercent(slice.value / total)])}
        caption={(valueName || 'Count') + ' by part, of ' + fmtInt(total)}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (valueName || 'Count') + ' split ' + slices.length + ' ways, ' + fmtInt(total) + ' in all. Switch to Table for the values.'
      }
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw. */
Donut.isEmpty = (props: DonutProps) => props.slices.every((slice) => !(slice.value > 0));
