/**
 * Company by platoon, on a sequential ramp.
 *
 * Magnitude, so one hue light to dark — a rainbow would invent categories the grid does not
 * have. The ramp is `--seq-1..5`, which is declared once per theme and is already the right
 * way round in both: in light it runs pale to deep on a white card, in dark it runs deep to
 * bright on a near-black one, so in both themes "more" is the cell that stands out further
 * from its surface. The previous implementation reversed the ramp by hand in the chart
 * code; here the tokens carry it and there is nothing to reverse.
 *
 * **An inferred cell is marked, not merely shaded.** `model/platoon.js` works a soldier's
 * platoon out of their 4D when the message did not state it, and a commander reading a
 * per-platoon rate needs to know which columns were stated and which were deduced. Colour
 * cannot carry that: the cell already spends its fill on magnitude, and a second hue would
 * be read as a value. So an inferred cell takes a 45° hatch in `--inferred` — a texture,
 * which survives a colour-blind reader and a greyscale printout alike, and which is the
 * same 45° rhythm `theme/components.css`'s `.inferred` uses on the table twin's cells, so
 * the two views mark it the same way.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipLines } from './tooltip.js';
import { axisOption, baseOption } from './theme.js';

/** @type {number} Pixels between hatch lines on an inferred cell. */
const HATCH_GAP = 6;

/** @type {string} What an inferred cell's tooltip says it is. */
const INFERRED_NOTE = 'Platoon inferred from the 4D, not stated in the message.';

/**
 * The 45° hatch filling one cell, clipped to the cell's own rectangle.
 *
 * Each stripe is drawn twice: a wider one in `--surface` and then a narrower one in
 * `--inferred` on top of it. One colour would be wrong on half the ramp — a translucent
 * grey vanishes into the darkest cells and the surface colour vanishes into the palest —
 * and which half depends on the theme. The pair contrasts against every step of `--seq` in
 * both themes, and reads as a groove rather than as a smudge.
 *
 * Clipped by arithmetic rather than by a clip path: a custom series' children are plain
 * zrender shapes, and computing the two ends of each line inside the rectangle is both
 * shorter than a clip group and immune to how a renderer chooses to honour one.
 * @param {number} x Left edge.
 * @param {number} y Top edge.
 * @param {number} width Cell width.
 * @param {number} height Cell height.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {Array<!Object>} Line shapes, backing stripes first.
 */
function hatch_(x, y, width, height, palette) {
  const under = [];
  const over = [];
  for (let offset = -height; offset < width; offset += HATCH_GAP) {
    const x1 = Math.max(x + offset, x);
    const x2 = Math.min(x + offset + height, x + width);
    if (x2 <= x1) {
      continue;
    }
    const shape = { x1, y1: y + (x1 - (x + offset)), x2, y2: y + (x2 - (x + offset)) };
    under.push({ type: 'line', shape, style: { stroke: palette.surface, lineWidth: 2.5 } });
    over.push({ type: 'line', shape, style: { stroke: palette.inferred, lineWidth: 1.5 } });
  }
  return [...under, ...over];
}

/**
 * The overlay series that marks inferred cells.
 *
 * Silent, so it never steals a hover from the heatmap cell underneath it — the tooltip a
 * reader wants is the one with the count in it.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {Array<{value: Array<number>}>} inferred Inferred cells as `[column, row]` pairs.
 * @returns {!Object} An ECharts series.
 */
function inferredOverlay_(palette, inferred) {
  return {
    type: 'custom',
    name: '__inferred',
    silent: true,
    legendHoverLink: false,
    data: inferred,
    renderItem: (params, api) => {
      const [width, height] = api.size([1, 1]);
      const [cx, cy] = api.coord([api.value(0), api.value(1)]);
      // Inset by the same 2px the heatmap leaves between cells, so the hatch sits inside
      // the cell rather than bridging the gap to its neighbour.
      const x = cx - width / 2 + 2;
      const y = cy - height / 2 + 2;
      const w = Math.max(0, width - 4);
      const h = Math.max(0, height - 4);
      return {
        type: 'group',
        children: [
          ...hatch_(x, y, w, h, palette),
          // An inset outline so the marked cell has a boundary of its own. `'none'` is
          // zrender's keyword for an unpainted fill, not a colour.
          {
            type: 'rect',
            shape: { x, y, width: w, height: h, r: 2 },
            style: { fill: 'none', stroke: palette.surface, lineWidth: 2.5 },
          },
          {
            type: 'rect',
            shape: { x, y, width: w, height: h, r: 2 },
            style: { fill: 'none', stroke: palette.inferred, lineWidth: 1.5 },
          },
        ],
      };
    },
  };
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { rows, columns, cells, valueName, detail } = props;
  const max = Math.max(1, ...cells.map((cell) => (Number.isFinite(cell.value) ? cell.value : 0)));
  const placed = cells
    .map((cell) => ({
      cell,
      column: columns.indexOf(cell.column),
      row: rows.indexOf(cell.row),
    }))
    .filter((entry) => entry.column >= 0 && entry.row >= 0);

  const base = baseOption(palette);
  const gridAxis = (data, extra) =>
    axisOption(palette, {
      type: 'category',
      data,
      splitLine: { show: false },
      axisLine: { show: false },
      ...extra,
    });

  return {
    ...base,
    grid: { ...base.grid, top: 12, bottom: 48 },
    tooltip: {
      ...base.tooltip,
      formatter: (params) => {
        const entry = params.data.cell;
        return tooltipLines(
          entry.row + ' · ' + entry.column,
          [
            (valueName || 'Value') + ': ' + fmtInt(entry.value),
            ...(detail ? detail(entry) : []),
            entry.inferred ? INFERRED_NOTE : '',
          ],
          palette
        );
      },
    },
    xAxis: gridAxis(columns, { axisLabel: { color: palette.inkMuted, fontSize: 11, fontFamily: palette.fontUi, interval: 0 } }),
    yAxis: gridAxis(rows, { inverse: true }),
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      // Labelled at both ends: a colour ramp with no numbers on it tells the reader that a
      // cell is darker, not by how much.
      itemWidth: 14,
      itemHeight: 160,
      text: [String(max), '0'],
      textGap: 8,
      textStyle: { color: palette.inkMuted, fontSize: 11, fontFamily: palette.fontUi },
      inRange: { color: palette.seq },
    },
    series: [
      {
        type: 'heatmap',
        name: valueName || 'Value',
        data: placed.map((entry) => ({
          value: [entry.column, entry.row, entry.cell.value],
          cell: entry.cell,
        })),
        // A 2px surface gap between cells, rather than a border drawn around each.
        itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: palette.ink, borderWidth: 2 } },
      },
      inferredOverlay_(
        palette,
        placed
          .filter((entry) => entry.cell.inferred)
          .map((entry) => ({ value: [entry.column, entry.row] }))
      ),
    ],
  };
}

/**
 * A company by platoon heatmap.
 * @param {{rows: string[], columns: string[],
 *     cells: Array<{row: string, column: string, value: ?number,
 *         inferred: (boolean|undefined)}>,
 *     valueName: (string|undefined), detail: (function(!Object): string[]|undefined),
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `rows` are normally `COMPANIES` and `columns` `PLATOONS`; a cell naming a row or
 *     column not on the axis is dropped rather than drawn somewhere wrong; `inferred`
 *     marks a cell whose platoon was worked out from the 4D and draws the hatch; `detail`
 *     adds tooltip lines for one cell — its text is inserted as text, never as markup;
 *     `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Heatmap(props) {
  const { rows, columns, cells, valueName, height = 300, view } = props;
  if (view === 'table') {
    const byKey = new Map(cells.map((cell) => [cell.row + '|' + cell.column, cell]));
    return (
      <TableTwin
        columns={[{ label: 'Company' }, ...columns.map((column) => ({ label: column, numeric: true }))]}
        rows={rows.map((row) => [
          row,
          ...columns.map((column) => {
            const cell = byKey.get(row + '|' + column);
            return {
              text: cell ? fmtInt(cell.value) : '—',
              inferred: Boolean(cell && cell.inferred),
            };
          }),
        ])}
        caption={(valueName || 'Value') + ' by company and platoon; hatched cells are inferred'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (valueName || 'Value') +
        ' for ' +
        rows.length +
        ' companies by ' +
        columns.length +
        ' platoons. Switch to Table for the values.'
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
Heatmap.isEmpty = (props) =>
  !props.rows ||
  props.rows.length === 0 ||
  !props.columns ||
  props.columns.length === 0 ||
  !props.cells ||
  props.cells.length === 0;
