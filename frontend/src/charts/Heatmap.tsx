/**
 * A grid of counts on the sequential ramp (one hue for magnitude; the tokens already run the right way
 * in both themes). An inferred cell takes a 45° hatch, a texture that survives colour blindness and
 * greyscale print, matching `.inferred` on the table twin.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtDayMonth, fmtInt } from '../format.ts';
import { tooltipLines } from './tooltip.ts';
import { axisOption, baseOption, type ChartOption, type Palette } from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';
import type { Cell } from '../model/metrics.ts';

/** A grid cell; `platoon` names the company's own platoon when columns are positions. */
export interface HeatCell extends Omit<Cell, 'value'> {
  value: number | null;
  inferred?: boolean;
  platoon?: string;
}

/**
 * A heatmap's props. A cell off the axes is dropped, never drawn somewhere wrong; `detail` adds tooltip
 * lines (inserted as text); `showValues` writes each count in its cell; `rowName` heads the table's rows.
 */
export interface HeatmapProps<C extends HeatCell = HeatCell> extends ChartViewProps {
  rows: string[];
  columns: string[];
  cells: C[];
  valueName?: string;
  rowName?: string;
  detail?: (cell: C) => string[];
  showValues?: boolean;
  height?: number;
}

/** A heatmap datum carrying its cell, as ECharts hands it back. */
type CellParam<C> = { data: { cell: C } };

/** What a custom series' renderItem gets to locate a cell. */
type RenderApi = { size: (value: number[]) => number[]; coord: (value: number[]) => number[]; value: (dimension: number) => number };

/** Pixels between hatch lines on an inferred cell. */
const HATCH_GAP = 6;

/** What an inferred cell's tooltip says it is. */
const INFERRED_NOTE = 'Platoon inferred from the 4D, not stated in the message.';

/**
 * The 45° hatch over one cell, clipped by arithmetic: each stripe twice, a wide `--surface` under a narrow
 * `--inferred`, so it contrasts with every step of the ramp in both themes.
 */
function hatch(x: number, y: number, width: number, height: number, palette: Palette): ChartOption[] {
  const under: ChartOption[] = [];
  const over: ChartOption[] = [];
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

/** The silent overlay series hatching inferred cells (`[column, row]`), so hover stays on the count. */
function inferredOverlay(palette: Palette, inferred: { value: number[] }[]): ChartOption {
  return {
    type: 'custom',
    name: '__inferred',
    silent: true,
    legendHoverLink: false,
    data: inferred,
    renderItem: (_params: unknown, api: RenderApi) => {
      const [width = 0, height = 0] = api.size([1, 1]);
      const [cx = 0, cy = 0] = api.coord([api.value(0), api.value(1)]);
      // Inset by the 2px gap between cells, so the hatch stays inside its cell.
      const x = cx - width / 2 + 2;
      const y = cy - height / 2 + 2;
      const w = Math.max(0, width - 4);
      const h = Math.max(0, height - 4);
      return {
        type: 'group',
        children: [
          ...hatch(x, y, w, h, palette),
          // An inset outline (`'none'` is zrender's unpainted fill).
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

/** The ECharts option. */
function option<C extends HeatCell>(props: HeatmapProps<C>, palette: Palette): ChartOption {
  const { rows, columns, cells, valueName, detail, showValues } = props;
  const named = cells.some((cell) => cell.platoon);
  const max = Math.max(1, ...cells.map((cell) => cell.value ?? 0));
  const placed = cells
    .map((cell) => ({
      cell,
      column: columns.indexOf(cell.column),
      row: rows.indexOf(cell.row),
    }))
    .filter((entry) => entry.column >= 0 && entry.row >= 0);

  const base = baseOption(palette);
  const gridAxis = (data: string[], extra: ChartOption) =>
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
      formatter: (params: CellParam<C>) => {
        const entry = params.data.cell;
        return tooltipLines(
          entry.row + ', ' + (entry.platoon ? entry.platoon + ' (' + entry.column + ')' : fmtDayMonth(entry.column)),
          [
            (valueName || 'Value') + ': ' + fmtInt(entry.value),
            ...(detail ? detail(entry) : []),
            entry.inferred ? INFERRED_NOTE : '',
          ],
          palette
        );
      },
    },
    // Every column labelled while they fit; a long date axis thins its labels instead.
    xAxis: gridAxis(columns, {
      axisLabel: {
        color: palette.inkMuted,
        fontSize: 11,
        fontFamily: palette.fontUi,
        interval: columns.length > 12 ? 'auto' : 0,
        formatter: fmtDayMonth,
      },
    }),
    yAxis: gridAxis(rows, { inverse: true }),
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      // Numbered at both ends, so the ramp says by how much, not only darker.
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
        // On a position grid the cell names its company's platoon; the halo keeps it legible.
        label: {
          show: named || Boolean(showValues),
          formatter: (params: CellParam<C>) => {
            const cell = params.data.cell;
            if (!named) return cell.value ? fmtInt(cell.value) : '';
            const label =
              cell.platoon && cell.platoon !== 'Coy HQ' && /^[0-9]+$/.test(cell.platoon)
                ? 'Plt ' + cell.platoon
                : cell.platoon;
            return label ? label + '\n' + fmtInt(cell.value) : '';
          },
          color: palette.ink,
          fontSize: 11,
          lineHeight: 14,
          fontFamily: palette.fontUi,
          textBorderColor: palette.surface,
          textBorderWidth: 2,
        },
        // A 2px surface gap between cells, rather than a border drawn around each.
        itemStyle: { borderColor: palette.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: palette.ink, borderWidth: 2 } },
      },
      inferredOverlay(
        palette,
        placed
          .filter((entry) => entry.cell.inferred)
          .map((entry) => ({ value: [entry.column, entry.row] }))
      ),
    ],
  };
}

/** A heatmap of counts (ISO-date columns labelled day and month), or its table twin. */
export function Heatmap<C extends HeatCell>(props: HeatmapProps<C>) {
  const { rows, columns, cells, valueName, rowName = 'Company', height = 300, view } = props;
  if (view === 'table') {
    const byKey = new Map(cells.map((cell) => [cell.row + '|' + cell.column, cell]));
    return (
      <TableTwin
        columns={[{ label: rowName }, ...columns.map((column) => ({ label: column, numeric: true }))]}
        rows={rows.map((row) => [
          row,
          ...columns.map((column) => {
            const cell = byKey.get(row + '|' + column);
            const value = cell ? fmtInt(cell.value) : '—';
            return { text: cell?.platoon ? cell.platoon + ': ' + value : value, inferred: Boolean(cell?.inferred) };
          }),
        ])}
        caption={(valueName || 'Value') + ' by ' + rowName.toLowerCase() + '; hatched cells are inferred'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={`${valueName || 'Value'} for ${rows.length} companies by ${columns.length} platoons. Switch to Table for the values.`}
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw. */
Heatmap.isEmpty = (props: HeatmapProps) => props.rows.length === 0 || props.columns.length === 0 || props.cells.length === 0;
