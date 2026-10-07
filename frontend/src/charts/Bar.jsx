/**
 * One measure across categories, ranked.
 *
 * Horizontal by default, because the categories this dashboard ranks are words and long
 * ones: clinic names, status buckets, the ten symptom labels from `model/symptoms.js`. A
 * column chart would turn every one of them into a rotated stub.
 *
 * **One hue for every bar.** The categories are identified by their axis labels, so colour
 * has no work left to do; painting each bar differently would spend six slots saying what
 * the labels already say, and colouring them darker-where-bigger would encode bar length
 * twice. The one exception is `standingOf`, which returns a semantic name — 'critical' for
 * a company that has not filed, say — because that is a reading's standing rather than its
 * identity, which is the one thing the semantic tokens are for.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipNode } from './tooltip.js';
import {
  axisOption,
  baseOption,
  gridOption,
  seriesColor,
  standingColor,
  valueAxisOption,
} from './theme.js';

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
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
      formatter: (params) =>
        tooltipNode(
          params[0].name,
          [{ label: valueName || 'Value', value: fmtInt(params[0].value), color: params[0].color }],
          palette
        ),
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
          // Set per item rather than only on the series: a data-level `itemStyle` replaces
          // the series-level one outright, so a radius declared only on the series would be
          // dropped here and the bar ends would square off. Found the hard way in
          // the previous implementation.
          itemStyle: {
            color:
              standingColor(palette, standingOf ? standingOf(index) : null) ||
              seriesColor(palette, slot),
            // Rounded at the data end, square at the baseline — the bar grows from a line,
            // and rounding that end would lift it off it.
            borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
          },
        })),
        barMaxWidth: 18,
        markLine: Number.isFinite(mean)
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: palette.inkMuted, type: 'solid', width: 1 },
              // Inside the plot: an end-positioned label is clipped by the grid. `rotate: 0`
              // because ECharts otherwise lays a markLine label along its line, and on a
              // horizontal bar chart that line is vertical — the caption came out running up
              // the page on its side.
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

/**
 * A ranked bar chart of one measure.
 * @param {{categories: string[], values: Array<?number>, valueName: (string|undefined),
 *     horizontal: (boolean|undefined), slot: (number|undefined),
 *     standingOf: (function(number): ?string|undefined), mean: (number|undefined),
 *     meanLabel: (string|undefined), height: (number|undefined),
 *     view: (string|undefined)}} props
 *     `categories` and `values` are parallel and already in the order to be drawn — this
 *     component ranks nothing, that is `model/leaderboards.js`'s job; `horizontal`
 *     defaults true; `slot` picks the single hue every bar wears; `standingOf` may return
 *     'good' | 'warning' | 'serious' | 'critical' to mark one bar's standing, or null;
 *     `mean` draws a reference rule labelled `meanLabel`; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Bar(props) {
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
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
Bar.isEmpty = (props) => !props.categories || props.categories.length === 0;
