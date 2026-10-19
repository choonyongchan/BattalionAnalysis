/**
 * The report-sick flow Sankey, drawn from `model/sankey.ts` unchanged. Colour follows the stage (column),
 * and an absence ("not recorded", "unaccounted") is neutral grey: a finding about recording, not an illness.
 */

import { Plot } from './Plot.tsx';
import { TableTwin } from './TableTwin.tsx';
import { fmtInt } from '../format.ts';
import { tooltipLines } from './tooltip.ts';
import { baseOption, seriesColor, type ChartOption, type Palette } from './theme.ts';
import type { ChartViewProps } from './ChartCard.tsx';
import type { FlowNode, Link } from '../model/sankey.ts';

/** The Sankey's props: `reportSickFlow`'s nodes and links. */
export interface SankeyProps extends ChartViewProps {
  nodes: FlowNode[];
  links: Link[];
  height?: number;
}

/** What the tooltip receives for a node or a ribbon. */
type FlowParam = { dataType: string; name: string; value: number; data: Link };

/** The model's stages in flow order; the index is the colour slot. */
const STAGES = ['reporting', 'reported', 'type', 'outcome', 'status'];

/** Node names that mean "nothing was recorded" rather than a category. */
const NEUTRAL_NAME = /\b(not recorded|none recorded|unstated|unknown|unmatched|unaccounted|no formsg submission|not submitted)\b/i;

/** A node's label without its stage prefix ("Type: RSI" reads "RSI"; the column says the stage). */
function shortName(name: string): string {
  const colon = name.indexOf(': ');
  return colon === -1 ? name : name.slice(colon + 2);
}

/** Whether a node stands for an absence rather than a category. */
function isNeutral(node: FlowNode): boolean {
  return NEUTRAL_NAME.test(node.name);
}

/** The colour a node wears. */
function nodeColor(palette: Palette, node: FlowNode): string {
  if (isNeutral(node)) {
    return palette.inkMuted;
  }
  const stage = STAGES.indexOf(node.stage);
  return seriesColor(palette, stage === -1 ? 0 : stage);
}

/** The ECharts option. */
function option(props: SankeyProps, palette: Palette): ChartOption {
  const { nodes, links } = props;
  const base = baseOption(palette);
  // Right-edge labels would clip, so terminal nodes (no outgoing link; ECharts justifies them to the
  // right edge whatever their stage) put their labels inward.
  const sources = new Set(links.map((link) => link.source));
  const isTerminal = (node: FlowNode) => !sources.has(node.name);

  return {
    ...base,
    grid: undefined,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      formatter: (params: FlowParam) =>
        params.dataType === 'edge'
          ? tooltipLines(
              shortName(params.data.source) + ' → ' + shortName(params.data.target),
              [fmtInt(params.data.value) + ' events'],
              palette
            )
          : tooltipLines(shortName(params.name), [fmtInt(params.value) + ' events'], palette),
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
        // Hovering a node dims everything off its path: "where did these go".
        emphasis: { focus: 'adjacency' },
        data: nodes.map((node) => ({
          name: node.name,
          itemStyle: { color: nodeColor(palette, node), borderWidth: 0 },
          label: {
            color: isNeutral(node) ? palette.inkFaint : palette.ink,
            position: isTerminal(node) ? 'left' : 'right',
          },
        })),
        links: links.map((link) => ({ ...link })),
        label: {
          color: palette.ink,
          fontSize: 11,
          fontFamily: palette.fontUi,
          formatter: (params: { name: string }) => shortName(params.name),
        },
        // `'source'`: each ribbon wears its source node's colour, so a neutral branch stays neutral.
        lineStyle: { color: 'source', opacity: 0.28, curveness: 0.5 },
      },
    ],
  };
}

/** The report-sick Sankey, or its table twin. */
export function Sankey(props: SankeyProps) {
  const { nodes, links, height = 420, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'From' }, { label: 'To' }, { label: 'Events', numeric: true }]}
        rows={links
          .slice()
          .sort((a, b) => b.value - a.value)
          .map((link) => [shortName(link.source), shortName(link.target), fmtInt(link.value)])}
        caption="Report-sick flow, one row per link"
      />
    );
  }
  return (
    <Plot
      height={height}
      label={`Report-sick flow: ${nodes.length} nodes, ${links.length} links. Switch to Table for the values.`}
      build={(palette) => option(props, palette)}
    />
  );
}

/** Whether there is nothing to draw. */
Sankey.isEmpty = (props: SankeyProps) => props.links.length === 0;
