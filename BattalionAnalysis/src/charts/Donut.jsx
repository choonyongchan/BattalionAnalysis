/**
 * Composition: how one whole is split, with the total in the middle.
 *
 * The one place a circle is the right answer here — the parts are mutually exclusive, they
 * sum to something a commander names out loud, and "how is the battalion split today" is a
 * question about composition rather than comparison. **It may only be used where the parts
 * genuinely sum to the whole named in the centre.** A ring of things that overlap, or that
 * leave a remainder, is a lie the shape tells on the author's behalf, and no caption
 * underneath undoes it. Where the parts do not sum, use `Bar`.
 *
 * A ring rather than a filled pie so the total can sit in the hole, which is the number
 * read first. Slices above a few percent are directly labelled with their name and count,
 * so identity never rests on colour alone; the ones below keep their legend entry, their
 * tooltip and their table row and stop competing for space they do not have.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt, fmtShareOf } from '../format.js';
import { tooltipLines } from './tooltip.js';
import { baseOption, legendOption, seriesColor } from './theme.js';

/** @type {number} Slices below this share of the whole carry no direct label. */
const LABEL_MIN_PERCENT = 3;

/** @type {number} Above this pixel width the legend sits beside the ring, not under it. */
const WIDE_CARD = 620;

/** @type {number} Below this width a slice label carries its value only, not its name. */
const NARROW_CARD = 420;

/**
 * Sums the slices.
 * @param {Array<{value: ?number}>} slices The slices.
 * @returns {number} The total.
 */
function total_(slices) {
  return slices.reduce((sum, slice) => sum + (Number.isFinite(slice.value) ? slice.value : 0), 0);
}

/**
 * The total, set in the ring's hole.
 *
 * Anchored to the ring's own centre rather than to the canvas: when the legend moves to the
 * right the ring slides left with it, and a canvas-centred total would sit off the hole and
 * over the slices. Carried forward from the previous implementation.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {string} label What the total counts.
 * @param {number} total The total.
 * @param {Array<string>} centre The ring's `[x, y]` percentages.
 * @returns {Array<!Object>} ECharts graphic elements.
 */
function centreLabel_(palette, label, total, centre) {
  const x = centre[0];
  const y = parseFloat(centre[1]);
  return [
    {
      type: 'text',
      left: x,
      top: y - 7 + '%',
      silent: true,
      style: {
        text: fmtInt(total),
        fill: palette.ink,
        // Proportional figures, not tabular: at 26px a tabular '121' looks loose.
        font: '600 26px ' + palette.fontDisplay,
        textAlign: 'center',
      },
    },
    {
      type: 'text',
      left: x,
      top: y + 3 + '%',
      silent: true,
      style: {
        text: label || '',
        fill: palette.inkMuted,
        font: '11px ' + palette.fontUi,
        textAlign: 'center',
      },
    },
  ];
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {number} width The container's current pixel width.
 * @returns {!Object} The option.
 */
function option_(props, palette, width) {
  const { slices, centreLabel } = props;
  const total = total_(slices);
  const wide = width >= WIDE_CARD;
  const centre = wide ? ['42%', '50%'] : ['50%', '44%'];

  return {
    ...baseOption(palette),
    grid: undefined,
    tooltip: {
      ...baseOption(palette).tooltip,
      formatter: (params) =>
        tooltipLines(
          params.name,
          [fmtInt(params.value) + ' of ' + fmtInt(total), fmtShareOf(params.value, total)],
          palette
        ),
    },
    legend: legendOption(
      palette,
      slices.map((slice) => slice.name),
      wide
        ? { orient: 'vertical', right: '4%', top: 'middle', left: 'auto', itemGap: 10 }
        : { bottom: 0, left: 'center', top: 'auto', right: 'auto' }
    ),
    series: [
      {
        type: 'pie',
        radius: ['50%', '74%'],
        center: centre,
        avoidLabelOverlap: true,
        padAngle: 1.2,
        // A 2px surface gap between slices, rather than a stroke drawn around each.
        itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 2 },
        label: {
          color: palette.inkMuted,
          fontSize: 11,
          // On a phone there is no room for a name beside the ring, and ECharts truncates
          // it to an ellipsis that says less than nothing. Below that width each slice
          // carries its value only and the legend underneath carries the names.
          formatter: (params) =>
            width < NARROW_CARD ? fmtInt(params.value) : params.name + '\n' + fmtInt(params.value),
        },
        labelLine: { lineStyle: { color: palette.hairline }, length: 8, length2: 8 },
        data: slices.map((slice, index) => {
          // Set on the item rather than decided in the formatter: returning an empty string
          // still reserves the label's slot and still draws its leader line, which lands on
          // the chart as a stub pointing at nothing.
          const labelled =
            total > 0 && ((slice.value || 0) / total) * 100 >= LABEL_MIN_PERCENT;
          return {
            name: slice.name,
            value: slice.value,
            label: { show: labelled },
            labelLine: { show: labelled },
            itemStyle: {
              color: slice.neutral
                ? palette.inkMuted
                : seriesColor(palette, slice.slot === undefined ? index : slice.slot),
            },
          };
        }),
      },
    ],
    graphic: total > 0 ? centreLabel_(palette, centreLabel, total, centre) : undefined,
  };
}

/**
 * A donut chart of parts of one whole.
 * @param {{slices: Array<{name: string, value: ?number, slot: (number|undefined),
 *         neutral: (boolean|undefined)}>,
 *     centreLabel: (string|undefined), height: (number|undefined),
 *     view: (string|undefined)}} props
 *     `slices` must sum to the whole named by `centreLabel` — see the file header; `slot`
 *     fixes a slice's hue to its identity; `neutral` draws a slice in muted ink, for an
 *     "unaccounted" part that should not read as another category; `view` is set by
 *     `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Donut(props) {
  const { slices, centreLabel, height = 300, view } = props;
  if (view === 'table') {
    const total = total_(slices);
    return (
      <TableTwin
        columns={[{ label: 'Part' }, { label: 'Count', numeric: true }, { label: 'Share', numeric: true }]}
        rows={[
          ...slices.map((slice) => [slice.name, fmtInt(slice.value), fmtShareOf(slice.value, total)]),
          [centreLabel || 'Total', fmtInt(total), '100.0%'],
        ]}
        caption={'Composition of ' + (centreLabel || 'the total')}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (centreLabel || 'Total') +
        ' split into ' +
        slices.length +
        ' parts. Switch to Table for the values.'
      }
      build={(palette, width) => option_(props, palette, width)}
    />
  );
}

/**
 * Whether there is anything to draw.
 *
 * A ring of zeroes draws a full circle in the first slice's colour, which is worse than
 * saying there is nothing.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
Donut.isEmpty = (props) => !props.slices || props.slices.length === 0 || total_(props.slices) === 0;
