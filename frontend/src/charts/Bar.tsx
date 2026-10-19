/**
 * One measure across categories, ranked. Horizontal by default (the labels are long words). One hue for
 * every bar, since the labels already identify them; `standingOf` may mark a bar's standing, never identity.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtInt } from '../format.ts';
import { tooltipNode } from './tooltip.ts';
import {
  axisOption,
  baseOption,
  gridOption,
  seriesColor,
  standingColor,
  valueAxisOption,
  type ChartOption,
  type Palette,
} from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';

/** A ranked bar chart's props; `categories` and `values` are parallel and already in draw order. */
export interface BarProps extends ChartViewProps {
  categories: string[];
  values: (number | null)[];
  valueName?: string;
  horizontal?: boolean;
  /** The series slot every bar wears. */
  slot?: number;
  /** A bar's standing ('good' … 'critical'), or null. */
  standingOf?: (index: number) => string | null;
  /** Draws a reference rule labelled `meanLabel` (default "median"). */
  mean?: number;
  meanLabel?: string;
  height?: number;
}

/** What an axis tooltip receives per series. */
type AxisParam = { name: string; value: number; color: string };

/** The ECharts option. */
function option(props: BarProps, palette: Palette): ChartOption {
  const { categories, values, valueName, horizontal = true, slot = 0, standingOf, mean, meanLabel } = props;
  const base = baseOption(palette);
  const categoryAxis = axisOption(palette, {
    type: 'category',
    data: categories,
    splitLine: { show: false },
  });
  const valueAxis = valueAxisOption(palette, valueName, !horizontal);

  return {
    ...base,
    grid: gridOption(palette, horizontal && Boolean(valueName)),
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: AxisParam[]) =>
        tooltipNode(params[0]!.name, [{ label: valueName || 'Value', value: fmtInt(params[0]!.value), color: params[0]!.color }], palette),
    },
    xAxis: horizontal ? valueAxis : categoryAxis,
    // Inverted so the first category sits at the top: a ranked list is read downward.
    yAxis: horizontal ? { ...categoryAxis, inverse: true } : valueAxis,
    series: [
      {
        type: 'bar',
        name: valueName || 'Value',
        data: values.map((value, index) => ({
          value,
          // Per item: a data-level `itemStyle` replaces the series one, radius included.
          itemStyle: {
            color:
              standingColor(palette, standingOf ? standingOf(index) : null) ||
              seriesColor(palette, slot),
            // Rounded at the data end only: the bar grows from its baseline.
            borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
          },
        })),
        barMaxWidth: 18,
        markLine: mean !== undefined && Number.isFinite(mean)
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: palette.inkMuted, type: 'solid', width: 1 },
              // Inside the plot (an end label is clipped), and unrotated (it would run up a vertical line).
              label: {
                formatter: meanLabel || 'median',
                position: horizontal ? 'insideEndTop' : 'insideStartTop',
                rotate: 0,
                color: palette.inkMuted,
                fontSize: 10,
              },
              data: [horizontal ? { xAxis: mean } : { yAxis: mean }],
            }
          : undefined,
      },
    ],
  };
}

/** A ranked bar chart of one measure, or its table twin. */
export function Bar(props: BarProps) {
  const { categories, values, valueName, height = 300, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Category' }, { label: valueName || 'Value', numeric: true }]}
        rows={categories.map((category, index) => [category, fmtInt(values[index])])}
        caption={valueName ? valueName + ' by category' : 'Values by category'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (valueName || 'Value') +
        ' across ' +
        categories.length +
        ' categories. Switch to Table for the values.'
      }
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw. */
Bar.isEmpty = (props: BarProps) => props.categories.length === 0;
