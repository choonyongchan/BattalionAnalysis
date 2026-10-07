/**
 * The report-sick flow, source through type through outcome.
 *
 * Takes `model/sankey.js`'s `reportSickFlow` output unchanged: nodes carrying a `stage`,
 * links carrying a value. Colour follows the stage, not the individual node — a Sankey's
 * columns are the categories a reader is comparing, and giving twenty nodes twenty hues
 * would spend the whole ramp on labels the diagram already prints beside each node.
 *
 * **An absence is drawn neutral, never as another category.** `sankey.js` refuses to drop
 * an unmatched event to tidy the diagram: "Type not recorded", "Not recorded", "FormSG
 * only" for the companies that file no forms at all — these get their own branches, and
 * they are findings about the recording, not findings about the battalion's health. A
 * neutral grey says "nothing was written down here"; a sixth categorical hue would say
 * "this is a kind of illness", which is a different and false claim.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { fmtInt } from '../format.js';
import { tooltipLines } from './tooltip.js';
import { baseOption, seriesColor } from './theme.js';

/** @type {string[]} `sankey.js`'s stages, in flow order; the index is the colour slot. */
const STAGES = ['reporting', 'reported', 'type', 'outcome', 'status'];

/** @type {!RegExp} Node names that mean "nothing was recorded" rather than a category. */
const NEUTRAL_NAME = /\b(not recorded|none recorded|unstated|unknown|unmatched|unaccounted|no formsg submission|not submitted)\b/i;

/**
 * The label shown beside a node.
 *
 * `sankey.js` prefixes every node with its stage ("Source: Both", "Status: Vocational") so
 * two stages can carry the same word without colliding in one namespace. The prefix is
 * scaffolding for the model, not something a reader needs beside every node when the
 * column position already says which stage it is.
 * @param {string} name The node's name.
 * @returns {string} The name without its stage prefix.
 */
function shortName_(name) {
  const colon = name.indexOf(': ');
  return colon === -1 ? name : name.slice(colon + 2);
}

/**
 * Whether a node stands for an absence rather than a category.
 * @param {{name: string}} node The node.
 * @returns {boolean} True when it should be drawn neutral.
 */
function isNeutral_(node) {
  return NEUTRAL_NAME.test(node.name);
}

/**
 * The colour a node wears.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {{name: string, stage: string}} node The node.
 * @returns {string} A colour resolved from a token.
 */
function nodeColor_(palette, node) {
  if (isNeutral_(node)) {
    return palette.inkMuted;
  }
  const stage = STAGES.indexOf(node.stage);
  return seriesColor(palette, stage === -1 ? 0 : stage);
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const { nodes, links } = props;
  const base = baseOption(palette);
  // The rightmost column's labels have nothing to their right but the card's edge, and
  // ECharts draws them there anyway — "Vocational" came out as "V". Flipping just that
  // column's labels inward keeps the diagram full width instead of buying the room by
  // shrinking it.
  //
  // Which nodes are in that column is a question about the links, not about `stage`:
  // ECharts' default `nodeAlign: 'justify'` pushes every node with no outgoing link to the
  // right edge, so "Outcome: MC" ends up beside "Status: Vocational" even though it is a
  // stage earlier. Reading it off the links is the only way to get both.
  const sources = new Set(links.map((link) => link.source));
  const isTerminal = (node) => !sources.has(node.name);

  return {
    ...base,
    grid: undefined,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params) =>
        params.dataType === 'edge'
          ? tooltipLines(
              shortName_(params.data.source) + ' → ' + shortName_(params.data.target),
              [fmtInt(params.data.value) + ' events'],
              palette
            )
          : tooltipLines(shortName_(params.name), [fmtInt(params.value) + ' events'], palette),
    },
    series: [
      {
        type: 'sankey',
        left: 8,
        right: 8,
        top: 12,
        bottom: 12,
        nodeGap: 14,
        nodeWidth: 12,
        // Adjacency focus rather than a series highlight: the question a reader has at a
        // node is "where did these go", and dimming everything not on its path answers it.
        emphasis: { focus: 'adjacency' },
        data: nodes.map((node) => ({
          name: node.name,
          itemStyle: { color: nodeColor_(palette, node), borderWidth: 0 },
          label: {
            color: isNeutral_(node) ? palette.inkFaint : palette.ink,
            position: isTerminal(node) ? 'left' : 'right',
          },
        })),
        links: links.map((link) => ({ ...link })),
        label: {
          color: palette.ink,
          fontSize: 11,
          fontFamily: palette.fontUi,
          formatter: (params) => shortName_(params.name),
        },
        // `'source'` is an ECharts keyword, not a colour: each ribbon takes the colour of
        // the node it leaves, so a neutral branch stays neutral all the way down.
        lineStyle: { color: 'source', opacity: 0.28, curveness: 0.5 },
      },
    ],
  };
}

/**
 * The report-sick Sankey.
 * @param {{nodes: Array<{name: string, stage: string}>,
 *     links: Array<{source: string, target: string, value: number}>,
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `nodes` and `links` are `model/sankey.js`'s `reportSickFlow` output, passed straight
 *     through; a node whose name contains "not recorded", "none recorded", "unstated",
 *     "unknown" or "unmatched" is drawn neutral rather than taking a categorical slot;
 *     `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Sankey(props) {
  const { nodes, links, height = 420, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'From' }, { label: 'To' }, { label: 'Events', numeric: true }]}
        rows={links
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((link) => [shortName_(link.source), shortName_(link.target), fmtInt(link.value)])}
        caption="Report-sick flow, one row per link"
      />
    );
  }
  return (
    <Plot
      height={height}
      label={
        'Report-sick flow: ' +
        nodes.length +
        ' nodes, ' +
        links.length +
        ' links. Switch to Table for the values.'
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
Sankey.isEmpty = (props) => !props.links || props.links.length === 0;
