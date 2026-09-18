/**
 * A trend over parade days, one line per company.
 *
 * The one thing this chart does differently from the implementation it replaces:
 * **`connectNulls` is false.** The previous implementation set it true and defended the
 * choice in a comment — a gapped line "reads as the rate having dropped to nothing". That defence is
 * wrong in this dataset. Only five of forty-five parade days carry all six companies, so
 * the holes are not rare accidents to be smoothed over; they are most of the picture. A
 * line drawn straight across a day nobody filed asserts a reading that was never taken,
 * and it asserts it in the same ink as the readings that were. The gap is the honest mark,
 * and the reader learns to see an unfiled day as a break in the line.
 *
 * Two annotation kinds ride on a carrier series rather than on the first data series, so
 * they survive a reader switching that company off in the legend: weekend bands behind the
 * plot in `--weekend-band`, and a vertical rule per public holiday in `--holiday-line`
 * carrying the holiday's name. A dip on a Saturday is a battalion that was not in camp,
 * not a battalion that got better, and without the band behind it the chart says the
 * second thing.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipNode } from './tooltip.js';
import { axisOption, baseOption, legendOption, seriesColor, valueAxisOption } from './theme.js';

/** @type {number} Above this many points the symbols merge into a smear and come off. */
const SYMBOL_LIMIT = 45;

/**
 * Narrows an annotation's date span to the categories actually on the axis.
 *
 * A weekend band or a holiday can only be drawn where the axis has a column for it. An
 * axis of parade days only has no Saturday to hang a band on, so rather than misplacing
 * the band at a neighbouring date the annotation is dropped.
 * @param {string} fromIso Inclusive start.
 * @param {string} toIso Inclusive end.
 * @param {string[]} categories The axis values, ascending.
 * @returns {?{from: string, to: string}} The clipped span, or null when nothing overlaps.
 */
function clipToAxis_(fromIso, toIso, categories) {
  const from = categories.find((value) => value >= fromIso);
  const to = categories.filter((value) => value <= toIso).pop();
  return from !== undefined && to !== undefined && from <= to ? { from, to } : null;
}

/**
 * The carrier series holding the weekend bands and holiday rules.
 *
 * An empty `line` series: it draws nothing itself, is absent from the legend, and cannot
 * be switched off — which is the point, since the annotations explain the data series and
 * should not vanish with whichever one happened to be carrying them.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {Array<{from: string, to: string}>} weekends Weekend bands, as from
 *     `model/calendarMarks.js`'s `weekendBands`.
 * @param {Array<{date: string, name: string}>} holidays Public holidays, as from
 *     `holidaysIn`.
 * @param {string[]} categories The axis values.
 * @returns {!Object} An ECharts series.
 */
function annotationSeries_(palette, weekends, holidays, categories) {
  const bands = weekends
    .map((band) => clipToAxis_(band.from, band.to, categories))
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
        // Labelled once, on the leftmost band. Repeating "Weekend" down a term's worth of
        // Saturdays is ink that says the same thing eight times.
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
        // Turned along the rule deliberately: a horizontal holiday name would overlap its
        // neighbour on any range holding two holidays in the same week.
        rotate: 90,
        position: 'insideEndTop',
        distance: 4,
        color: palette.inkMuted,
        fontSize: 10,
        formatter: (params) => params.name,
      },
      data: rules.map((holiday) => ({ xAxis: holiday.date, name: holiday.name })),
    },
  };
}

/** @type {string} The carrier series' name, kept out of the legend. */
const ANNOTATION_SERIES = '__annotations';

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { categories, series, valueName, weekends = [], holidays = [] } = props;
  const base = baseOption(palette);

  return {
    ...base,
    grid: { ...base.grid, top: 36 },
    legend: legendOption(
      palette,
      series.map((entry) => entry.name)
    ),
    tooltip: {
      ...base.tooltip,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: palette.hairline } },
      formatter: (params) => {
        const points = params.filter((point) => point.seriesName !== ANNOTATION_SERIES);
        return tooltipNode(
          points.length ? points[0].axisValue : null,
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
    // `boundaryGap: false` puts the first and last points hard against the plot edges, and
    // their labels are centred on them — so half of each hangs outside the SVG. Anchoring
    // the two end labels inward is what keeps the date range readable, and is carried
    // forward from the previous implementation.
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
      },
    }),
    yAxis: valueAxisOption(palette, valueName, true),
    series: [
      annotationSeries_(palette, weekends, holidays, categories),
      ...series.map((entry, index) => {
        const color = entry.neutral
          ? palette.inkMuted
          : seriesColor(palette, entry.slot === undefined ? index : entry.slot);
        return {
          type: 'line',
          name: entry.name,
          data: entry.values,
          smooth: false,
          symbol: 'circle',
          symbolSize: 8,
          // Below the limit each reading is a mark a reader can hover and count; above it
          // the marks touch and the line becomes a caterpillar.
          showSymbol: categories.length <= SYMBOL_LIMIT,
          // A 2px surface ring, so a marker stays legible where two series cross.
          itemStyle: { color, borderColor: palette.surface, borderWidth: 2 },
          lineStyle: { width: 2, color, cap: 'round', join: 'round' },
          // See the file header: a day nobody filed is a gap, not an interpolation.
          connectNulls: false,
        };
      }),
    ],
  };
}

/**
 * A multi-series time series with weekend and holiday annotations.
 * @param {{categories: string[],
 *     series: Array<{name: string, values: Array<?number>, slot: (number|undefined),
 *         neutral: (boolean|undefined)}>,
 *     valueName: (string|undefined),
 *     weekends: (Array<{from: string, to: string}>|undefined),
 *     holidays: (Array<{date: string, name: string}>|undefined),
 *     height: (number|undefined),
 *     view: (string|undefined)}} props
 *     `categories` are the axis values, ascending, normally ISO dates; a `series` value of
 *     `null` is a day that company did not file and is drawn as a gap; `slot` fixes the
 *     colour to a company's identity (pass `COMPANIES.indexOf(name)`) so a filter never
 *     repaints the survivors; `neutral` draws the series in muted ink, for a battalion
 *     total or a baseline that is not one of the six; `weekends` and `holidays` take the
 *     shapes `model/calendarMarks.js` returns and are silently dropped where the axis has
 *     no column for them; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Line(props) {
  const { categories, series, valueName, height = 300, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[
          { label: 'Date' },
          ...series.map((entry) => ({ label: entry.name, numeric: true })),
        ]}
        rows={categories.map((category, index) => [
          category,
          ...series.map((entry) => fmtInt(entry.values[index])),
        ])}
        caption={valueName ? valueName + ' by day' : 'Values by day'}
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        (valueName || 'Trend') +
        ' over ' +
        categories.length +
        ' days, ' +
        series.length +
        ' series. Switch to Table for the values.'
      }
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 *
 * A series of all nulls is not data: it is a company that filed nothing in the window, and
 * six of those is an empty chart with six legend entries on it.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
Line.isEmpty = (props) =>
  !props.categories ||
  props.categories.length === 0 ||
  !props.series ||
  props.series.length === 0 ||
  props.series.every((entry) =>
    (entry.values || []).every((value) => value === null || value === undefined)
  );
