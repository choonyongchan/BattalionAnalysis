/**
 * Parts of one whole, as a ring.
 *
 * Only for a true part-to-whole of five or six parts, where the question is "what share of
 * the total is this": today's strength split into present and each kind of absence, or the
 * report-sick types on the form. A ranking, a trend or anything with more parts is a bar or
 * a line; past six slices a ring stops being readable and this component is the wrong one.
 *
 * **Colour follows identity, never position.** A slice that is a company takes that
 * company's slot, so Archer is the same blue here as on every line chart. Any other part
 * takes the sequential ramp, darkest for the largest, so no non-company part ever wears a
 * company's colour. A `neutral` slice (the "present" majority, say) is drawn in the sunken
 * canvas tone so the absences, which are the point, carry the ink.
 *
 * Every slice is labelled on the ring with its name, count and share, so the reader never
 * matches colours to a legend.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt, fmtPercent } from '../format.js';
import { tooltipNode } from './tooltip.js';
import { baseOption, seriesColor } from './theme.js';

/**
 * The colour each slice wears.
 * @param {Array<{value: number, slot: (number|undefined), neutral: (boolean|undefined)}>} slices
 *     The slices, in drawing order.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {string[]} One colour per slice.
 */
function colours_(slices, palette) {
  const ranked = slices
    .map((slice, index) => ({ index, value: slice.value }))
    .filter(({ index }) => slices[index].slot === undefined && !slices[index].neutral)
    .sort((a, b) => b.value - a.value);
  const ramp = palette.seq.slice().reverse();
  const shade = new Map(ranked.map(({ index }, rank) => [index, ramp[Math.min(rank, ramp.length - 1)]]));
  return slices.map((slice, index) =>
    slice.neutral ? palette.canvasSunken : slice.slot !== undefined ? seriesColor(palette, slice.slot) : shade.get(index)
  );
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { slices, valueName } = props;
  const base = baseOption(palette);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const colours = colours_(slices, palette);
  return {
    ...base,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params) =>
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
          formatter: (params) => params.name + '\n' + fmtInt(params.value) + ' (' + fmtPercent(params.value / total) + ')',
        },
        labelLine: { length: 14, length2: 12, lineStyle: { color: palette.hairline } },
        data: slices.map((slice, index) => ({ slice, index })).filter(({ slice }) => slice.value > 0).map(({ slice, index }) => ({
          name: slice.name,
          value: slice.value,
          itemStyle: { color: colours[index] },
        })),
      },
    ],
  };
}

/**
 * A donut of parts of one whole.
 * @param {{slices: Array<{name: string, value: number, slot: (number|undefined),
 *     neutral: (boolean|undefined)}>, valueName: (string|undefined),
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `slices` in the order to draw them, clockwise from twelve; `slot` fixes a company
 *     slice to that company's colour; `neutral` mutes the majority part; `view` is set by
 *     `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Donut(props) {
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
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when every slice is empty.
 */
Donut.isEmpty = (props) => !props.slices || props.slices.every((slice) => !(slice.value > 0));
