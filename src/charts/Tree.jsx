/**
 * The ORBAT command tree: CDO over CDS, COS beside it, PDS1–4 beneath.
 *
 * Horizontal, because the tree is seven roles deep in name length and four wide, and a
 * top-down layout would stack seven-character ranks over forty-character names. Left to
 * right the labels run along their natural axis and the whole battalion fits without
 * scrolling sideways.
 *
 * **A role nobody filed is drawn, muted, in its place.** `model/orbat.js` returns every
 * role in `COMMAND_ROLES` whether or not a roster named it, and says why: Braves and
 * Scorpion file no roster ever, Cougar files three rows in total. A tree that quietly
 * omitted the unfilled roles would look complete and would not be, and the gap in the
 * chain of command is the finding a commander opens this page for. Muted ink and a hollow
 * node say "this position exists and is unaccounted for", which is the true statement.
 */

import { Plot } from './Plot.jsx';
import { TableTwin } from './TableTwin.jsx';
import { tooltipLines } from './tooltip.js';
import { baseOption } from './theme.js';

/**
 * Rewrites one model node into an ECharts tree node, carrying its own styling.
 *
 * The model's fields are kept on the node rather than looked up again at paint time, so a
 * tooltip and a label read from the same object the tree was built from.
 * @param {!Object} palette A palette from `readPalette`.
 * @param {{name: string, role: string, rank: (string|undefined), filed: boolean,
 *     children: (Array<!Object>|undefined)}} node A node from `orbatTree`.
 * @returns {!Object} An ECharts tree node.
 */
function decorate_(palette, node) {
  const filed = Boolean(node.filed);
  return {
    name: node.name,
    role: node.role,
    rank: node.rank || '',
    filed,
    // A filled node in the accent for a role that is accounted for; a node in the
    // `--inferred` grey for one that is not. The accent rather than a series slot because
    // a tree has no series: every node is the same kind of thing.
    itemStyle: {
      color: filed ? palette.accent : palette.inferred,
      borderColor: palette.surface,
      borderWidth: 2,
    },
    label: { color: filed ? palette.ink : palette.inkFaint },
    children: (node.children || []).map((child) => decorate_(palette, child)),
  };
}

/**
 * Builds the ECharts option.
 * @param {!Object} props The component's props.
 * @param {!Object} palette A palette from `readPalette`.
 * @returns {!Object} The option.
 */
function option_(props, palette) {
  const base = baseOption(palette);
  return {
    ...base,
    grid: undefined,
    tooltip: {
      ...base.tooltip,
      trigger: 'item',
      triggerOn: 'mousemove',
      formatter: (params) => {
        const data = params.data || {};
        return tooltipLines(
          params.name,
          [
            data.role && data.role !== 'NONE' ? data.role : '',
            data.filed ? '' : 'No name filed for this role.',
          ],
          palette
        );
      },
    },
    series: [
      {
        type: 'tree',
        data: [decorate_(palette, props.tree)],
        orient: 'LR',
        layout: 'orthogonal',
        left: 12,
        // Generous on the right: the deepest labels sit at the right edge and run outward,
        // and ECharts will happily draw them past the SVG's boundary.
        right: '24%',
        top: 16,
        bottom: 16,
        symbol: 'circle',
        symbolSize: 9,
        // Expanded to the leaves. A commander opening the ORBAT wants the chain of command,
        // not a root node to click.
        initialTreeDepth: -1,
        expandAndCollapse: true,
        edgeShape: 'curve',
        lineStyle: { color: palette.hairline, width: 1, curveness: 0.5 },
        label: {
          position: 'right',
          align: 'left',
          verticalAlign: 'middle',
          distance: 8,
          fontSize: 12,
          fontFamily: palette.fontUi,
          // The role beside the name: 'PDS2 · CPL Tan' says more than either half alone,
          // and ECharts renders a label as SVG text, so a name typed into WhatsApp is never
          // parsed as markup on its way here.
          formatter: (params) => {
            const role = (params.data || {}).role;
            return role && !['COMPANY', 'BATTALION', 'NONE'].includes(role)
              ? role + ' · ' + params.name
              : params.name;
          },
        },
        leaves: { label: { position: 'right', align: 'left' } },
        emphasis: { focus: 'descendant' },
      },
    ],
  };
}

/**
 * Flattens the tree into rows for the table twin.
 * @param {!Object} node The node to walk.
 * @param {number} depth How deep it sits, for the indent.
 * @param {Array<Array<*>>} rows Accumulator.
 * @returns {Array<Array<*>>} `rows`, for chaining.
 */
function flatten_(node, depth, rows) {
  rows.push([
    '  '.repeat(depth) + node.name,
    node.role || '',
    node.filed ? 'Filed' : 'Not filed',
  ]);
  (node.children || []).forEach((child) => flatten_(child, depth + 1, rows));
  return rows;
}

/**
 * The ORBAT command tree.
 * @param {{tree: {name: string, role: string, rank: (string|undefined), filed: boolean,
 *         children: (Array<!Object>|undefined)},
 *     height: (number|undefined), view: (string|undefined)}} props
 *     `tree` is `model/orbat.js`'s `orbatTree` output, passed straight through — a
 *     battalion root with six company subtrees, or a single company's tree; `height`
 *     should grow with the node count, since a tree cannot be scrolled inside its own
 *     plot; `view` is set by `ChartCard`.
 * @returns {!Object} The chart, or its table twin.
 */
export function Tree(props) {
  const { tree, height = 480, view } = props;
  if (view === 'table') {
    return (
      <TableTwin
        columns={[{ label: 'Name' }, { label: 'Role' }, { label: 'Status' }]}
        rows={flatten_(tree, 0, [])}
        caption="Command roster, indented by position in the chain of command"
      />
    );
  }
  return (
    <Plot
      height={height}
      label={'Command tree for ' + tree.name + '. Switch to Table for the roster.'}
      build={(palette) => option_(props, palette)}
    />
  );
}

/**
 * Whether there is anything to draw.
 * @param {!Object} props The component's props.
 * @returns {boolean} True when the chart has nothing to show.
 */
Tree.isEmpty = (props) => !props.tree || !props.tree.name;
