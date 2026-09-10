/**
 * One shared time-of-day rail: who has filed this morning's parade state, and when.
 *
 * This is the first thing a commander sees each day, and the question it answers is not
 * "how many filed" — that is a number, and a number belongs in a tile. It is "who is
 * still outstanding, and how late is everyone else running", which is a question about
 * *positions on a shared clock*, and that is what the rail is for: a single horizontal
 * axis of time of day, with one dot per company that has filed, sitting at the minute it
 * came in.
 *
 * The data has two shapes and the rail draws them differently:
 *
 * - **Filed, with a time of day.** A filled dot on the rail at the filing time, in the
 *   company's own palette colour — the same slot it wears on the Line chart and everywhere
 *   else — with a small label of the company name and the clock time beside it. Six dots
 *   of different positions sort themselves without the reader parsing a single number.
 * - **Incomplete.** Not filed at all, or filed with a timestamp that carries no time of
 *   day (`values.js`'s `toTimeOfDay` returns null for those). Either way the company has
 *   no minute to stand on, so it gets no position on the clock: a grey dot in a holding
 *   tray beneath the rail, labelled with just the company name. "Hasn't filed yet this
 *   morning" is not an error on a rail — it is the normal state at 06:30 — so the tray is
 *   a quiet neutral grey, not a red wash.
 *
 * The whole point of `model/submissions.js`'s `filingsOn` is absence: it always returns
 * all six companies "because a chart built only from who filed cannot show who did not".
 * So a morning where nobody has filed is a full tray and an empty rail, and that is a
 * statement, not an empty state — `Timeline.isEmpty` is true only when there are no
 * companies at all.
 *
 * Drawn as a `custom` series rather than a scatter because the rail is not just points: it
 * is a hairline, a row of dots on it, a stack of labels that dodge apart when two filings
 * land within a few minutes of each other, and a tray of dots that are deliberately *not*
 * on the time axis. `renderItem` is the only place ECharts lets those be one mark, and the
 * pre-computed placement (`placeEntries_`) is what keeps the dodge decisions out of it.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtClock } from '../format.js';
import { tooltipLines } from './tooltip.js';
import { axisOption, baseOption, seriesColor } from './theme.js';
import { COMPANIES } from '../model/domain.js';

/** @type {number} Minutes of padding either side of the observed filings. */
const WINDOW_PAD = 45;

/** @type {number} Narrowest window drawn, in minutes; keeps one filing from filling the day. */
const MIN_SPAN = 240;

/** @type {number} Default window start when nothing has been filed at all: 06:00. */
const DEFAULT_FROM = 6 * 60;

/** @type {number} Default window end when nothing has been filed at all: 12:00. */
const DEFAULT_TO = 12 * 60;

/** @type {number} Pixels from the grid top down to the rail hairline. */
const RAIL_TOP_GAP = 18;

/** @type {number} Pixels from the rail down to the first row of dot labels. */
const LABEL_OFFSET = 12;

/** @type {number} Height of one dodged label row, in pixels. */
const LABEL_STEP = 16;

/** @type {number} Radius of an on-rail filing dot. */
const DOT_R = 6;

/** @type {number} Radius of a holding-tray dot. */
const TRAY_DOT_R = 5;

/** @type {number} Left inset of the first tray dot from the grid edge, in pixels. */
const TRAY_PAD = 4;

/**
 * Whether an entry has earned a place on the rail: filed, with a real time of day.
 * @param {{filed: boolean, at: ?{minutes: number}}} entry One entry from `filingsOn`.
 * @returns {boolean} True when the entry can be placed at a minute on the rail.
 */
function onRail_(entry) {
  return Boolean(entry.filed && entry.at && Number.isFinite(entry.at.minutes));
}

/**
 * The clock window the rail is drawn across.
 *
 * Data-driven rather than a fixed 00:00–24:00 day: filings cluster in a couple of hours,
 * and a full day squeezes the whole story into a tenth of the width. Padded and floored to
 * whole hours so the axis ticks land on round times. Driven only by the companies that
 * filed with a time — the tray has no bearing on where the clock starts or ends.
 * @param {Array<!Object>} entries Entries from `filingsOn`.
 * @param {?number} from An explicit window start in minutes, or null.
 * @param {?number} to An explicit window end in minutes, or null.
 * @returns {{from: number, to: number}} The window, in minutes past midnight.
 */
function windowFor_(entries, from, to) {
  const times = entries.filter(onRail_).map((entry) => entry.at.minutes);
  if (times.length === 0) {
    return { from: from ?? DEFAULT_FROM, to: to ?? DEFAULT_TO };
  }
  let start = from ?? Math.floor((Math.min(...times) - WINDOW_PAD) / 60) * 60;
  let end = to ?? Math.ceil((Math.max(...times) + WINDOW_PAD) / 60) * 60;
  if (end - start < MIN_SPAN) {
    end = start + MIN_SPAN;
  }
  return { from: Math.max(0, start), to: Math.min(1440, end) };
}

/**
 * How close two filings may be, in minutes, before their labels are dodged apart.
 *
 * Scaled to the drawn window so the gap stays visually similar whatever the span: a label
 * is a fixed width in pixels, and a wider window packs more minutes into that width.
 * @param {{from: number, to: number}} span The drawn clock window.
 * @returns {number} A minute threshold.
 */
function collideMinutes_(span) {
  return Math.max(12, Math.round((span.to - span.from) * 0.08));
}

/**
 * Works out where every company's mark goes before the chart is drawn.
 *
 * On-rail entries are sorted by time and handed a dodge level: a fresh level each time the
 * next filing lands within `collideMinutes_` of the last one already parked on that level,
 * so no two labels share a line closely enough to overprint. Incomplete entries are handed
 * a left-to-right slot in the holding tray; they have no time, so they get no position on
 * the clock.
 * @param {Array<!Object>} entries Entries from `filingsOn`, in COMPANIES order.
 * @param {{from: number, to: number}} span The drawn clock window.
 * @returns {Array<{entry: !Object, onRail: boolean, minutes: ?number, dodge: number,
 *     trayCol: number, slot: number}>} One placement per entry, in `entries` order.
 */
function placeEntries_(entries, span) {
  const threshold = collideMinutes_(span);
  const placements = entries.map((entry) => ({
    entry,
    onRail: onRail_(entry),
    minutes: onRail_(entry) ? entry.at.minutes : null,
    // The colour slot is the company's identity, not its position here: Archer is the same
    // blue on every chart, and filtering companies out never repaints the survivors.
    slot: COMPANIES.indexOf(entry.company),
    dodge: 0,
    trayCol: 0,
  }));

  const lastAtLevel = [];
  placements
    .filter((placement) => placement.onRail)
    .sort((a, b) => a.minutes - b.minutes)
    .forEach((placement) => {
      let level = 0;
      while (lastAtLevel[level] != null && placement.minutes - lastAtLevel[level] < threshold) {
        level += 1;
      }
      lastAtLevel[level] = placement.minutes;
      placement.dodge = level;
    });

  let column = 0;
  placements
    .filter((placement) => !placement.onRail)
    .forEach((placement) => {
      placement.trayCol = column;
      column += 1;
    });

  return placements;
}

/**
 * Width of one holding-tray slot, so every incomplete company gets an equal share of the
 * plot width to sit its dot and name in.
 * @param {!Object} grid The `params.coordSys` rectangle.
 * @param {Array<!Object>} placements Output of `placeEntries_`.
 * @returns {number} A slot width in pixels.
 */
function traySlot_(grid, placements) {
  const trayCount = placements.filter((placement) => !placement.onRail).length;
  return (grid.width - TRAY_PAD * 2) / Math.max(1, trayCount);
}

/**
 * Draws one company's mark, plus the shared rail hairline on the first item.
 *
 * `params.coordSys` gives the plot rectangle, which is what lets the rail span the full
 * width and the tray sit off the time axis regardless of where the dots fall.
 * @param {!Object} params ECharts renderItem params.
 * @param {!Object} api ECharts renderItem api.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {Array<!Object>} placements Output of `placeEntries_`, closed over from `option_`.
 * @returns {!Object} A zrender group.
 */
function renderMark_(params, api, palette, placements) {
  const grid = params.coordSys;
  const placement = placements[params.dataIndex];
  const railY = grid.y + RAIL_TOP_GAP;
  const maxDodge = placements.reduce((max, item) => Math.max(max, item.dodge), 0);
  const trayY = Math.min(
    railY + LABEL_OFFSET + (maxDodge + 1) * LABEL_STEP + 10,
    grid.y + grid.height - 10
  );

  const children = [];

  // The rail: one hairline the whole width of the plot, drawn once so it does not depend
  // on any one company's data.
  if (params.dataIndex === 0) {
    children.push({
      type: 'line',
      shape: { x1: grid.x, y1: railY, x2: grid.x + grid.width, y2: railY },
      style: { stroke: palette.hairline, lineWidth: 1 },
      silent: true,
    });
  }

  if (placement.onRail) {
    const dotX = Math.max(
      grid.x,
      Math.min(grid.x + grid.width, api.coord([placement.minutes, 0])[0])
    );
    const color = seriesColor(palette, placement.slot);
    const labelY = railY + LABEL_OFFSET + placement.dodge * LABEL_STEP;
    // A label placed unconditionally to the right is clipped for the company that filed
    // last; near the right edge it flips to sit on the left of its dot.
    const nearRight = dotX > grid.x + grid.width - 96;
    children.push({
      type: 'circle',
      shape: { cx: dotX, cy: railY, r: DOT_R },
      // A 2px surface ring keeps the dot legible where it sits on the hairline.
      style: { fill: color, stroke: palette.surface, lineWidth: 2 },
    });
    children.push({
      type: 'text',
      style: {
        text: placement.entry.company + ' ' + fmtClock(placement.minutes),
        x: nearRight ? dotX - DOT_R - 4 : dotX + DOT_R + 4,
        y: labelY,
        fill: palette.ink,
        font: '12px ' + palette.fontUi,
        textAlign: nearRight ? 'right' : 'left',
        textVerticalAlign: 'top',
      },
    });
    return { type: 'group', children };
  }

  // Incomplete: a grey dot in the holding tray, off the clock, labelled with just the
  // name. No time of day means no minute to stand on.
  const trayX = grid.x + TRAY_PAD + placement.trayCol * traySlot_(grid, placements);
  children.push({
    type: 'circle',
    shape: { cx: trayX + TRAY_DOT_R, cy: trayY, r: TRAY_DOT_R },
    style: { fill: palette.inkMuted, stroke: palette.surface, lineWidth: 2 },
  });
  children.push({
    type: 'text',
    style: {
      text: placement.entry.company,
      x: trayX + TRAY_DOT_R * 2 + 6,
      y: trayY,
      fill: palette.inkMuted,
      font: '12px ' + palette.fontUi,
      textVerticalAlign: 'middle',
    },
  });
  return { type: 'group', children };
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { entries, deadline, from = null, to = null } = props;
  const span = windowFor_(entries, from, to);
  const placements = placeEntries_(entries, span);
  const base = baseOption(palette);

  return {
    ...base,
    // No bottom unit: the axis is a clock and says so in its own labels. The top gap is
    // the deadline rule's label, which sits above the plot.
    grid: { left: 8, right: 16, top: deadline ? 24 : 10, bottom: 8, containLabel: true },
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params) => {
        const entry = params.data.entry;
        return tooltipLines(
          entry.company,
          [
            onRail_(entry) ? 'Filed at ' + fmtClock(entry.at.minutes) : '',
            entry.filed && !onRail_(entry)
              ? 'Filed, but the timestamp carries no time of day.'
              : '',
            !entry.filed ? 'No parade state filed for this session.' : '',
          ],
          palette
        );
      },
    },
    xAxis: axisOption(palette, {
      type: 'value',
      min: span.from,
      max: span.to,
      interval: Math.max(30, Math.round((span.to - span.from) / 6 / 30) * 30),
      axisLabel: {
        color: palette.inkMuted,
        fontSize: 11,
        fontFamily: palette.fontUi,
        formatter: (value) => fmtClock(value),
      },
      splitLine: { show: false },
      // The rail hairline is drawn in `renderMark_`; the axis line would be a second rule.
      axisLine: { show: false },
    }),
    // A hidden carrier axis: the marks are placed by pixel maths in `renderMark_`, not by
    // a y encoding, so this axis only has to exist for `api.coord` to resolve an x.
    yAxis: { type: 'value', min: 0, max: 1, show: false },
    series: [
      {
        type: 'custom',
        name: 'Filing',
        renderItem: (params, api) => renderMark_(params, api, palette, placements),
        // Encoded so the tooltip knows which axis the value belongs to.
        encode: { x: 0, y: 1 },
        data: placements.map((placement) => ({
          value: [placement.onRail ? placement.minutes : span.from, 0],
          entry: placement.entry,
        })),
      },
      {
        // An empty carrier for the deadline rule, so the rule does not depend on the mark
        // series' data and does not move when a company's state changes.
        type: 'line',
        name: '__deadline',
        silent: true,
        data: [],
        markLine: deadline
          ? {
              silent: true,
              symbol: 'none',
              lineStyle: { color: palette.inkMuted, width: 1, type: 'solid' },
              label: {
                formatter: deadline.label || fmtClock(deadline.minutes),
                // Above the plot, and unrotated: ECharts otherwise lays a markLine's label
                // along its own line, and this line is vertical. `'end'` is the carrier
                // axis's max end, which on a vertical rule is the top — clear of the rail,
                // the dots and the ticks.
                position: 'end',
                rotate: 0,
                color: palette.inkMuted,
                fontSize: 11,
              },
              data: [{ xAxis: deadline.minutes }],
            }
          : undefined,
      },
    ],
  };
}

/**
 * The morning filing timeline: one rail, one day.
 * @param {{entries: Array<{company: string, filed: boolean, at: ?{hour: number,
 *         minute: number, minutes: number}}>,
 *     deadline: ({minutes: number, label: (string|undefined)}|undefined),
 *     from: (number|undefined), to: (number|undefined),
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `entries` is `model/submissions.js`'s `filingsOn` output, passed straight through and
 *     already in `COMPANIES` order — the colour slots come from that order, so do not sort
 *     it; `deadline` draws a labelled vertical rule at a time of day the parade state is
 *     expected by; `from` and `to` override the computed clock window, in minutes past
 *     midnight; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Timeline(props) {
  // A rail plus its label stack and tray needs far less height than the old six lanes; a
  // little grows with the company count to leave room for dodged labels.
  const { entries, height = 96 + 16 * (props.entries || []).length, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Company' }, { label: 'Filed' }, { label: 'Time', numeric: true }]}
        rows={entries.map((entry) => [
          entry.company,
          entry.filed ? 'Yes' : 'No',
          onRail_(entry) ? fmtClock(entry.at.minutes) : '—',
        ])}
        caption="Parade state filing time by company"
      />
    );
  }
  const filed = entries.filter((entry) => entry.filed).length;
  return (
    <Plot
      height={height}
      label={
        filed + ' of ' + entries.length + ' companies filed. Switch to Table for the times.'
      }
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 *
 * Note what is deliberately *not* empty: six companies that have all filed nothing. That
 * is the most important thing this chart ever shows — an empty rail and a full tray — and
 * hiding it behind an empty state would turn the worst morning of the term into a blank
 * card.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when there are no companies at all.
 */
Timeline.isEmpty = (props) => !props.entries || props.entries.length === 0;
