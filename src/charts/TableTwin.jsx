/**
 * The table half of every chart card.
 *
 * The previous implementation called the table twin "half the feature" and it is right:
 * it is the accessible equivalent for anything encoded by colour or position, it is what S1 copies figures out
 * of into a brief, and it is what makes a tooltip an enhancement rather than the only way
 * to read a value. Every chart component in this directory builds one of these from the
 * same props it draws from, so the two views cannot disagree — the table is never assembled
 * separately by the page.
 *
 * A cell may be `{text, inferred: true}` to mark a value the dashboard worked out rather
 * than read; it takes the `.inferred` hatch from `theme/components.css`, the same texture
 * the Heatmap draws over an inferred cell.
 */

/**
 * Renders one cell's content, mapping a missing value to an em dash.
 * @param {(string|number|null|undefined|{text: string, inferred: boolean})} cell The cell.
 * @param {boolean} numeric Whether the column is numeric.
 * @returns {!Object} A `<td>`.
 */
function Cell({ cell, numeric }) {
  const value = cell && typeof cell === 'object' ? cell : { text: cell, inferred: false };
  const text =
    value.text === null || value.text === undefined || value.text === '' ? '—' : String(value.text);
  return (
    <td class={[numeric ? 'num' : '', value.inferred ? 'inferred' : ''].filter(Boolean).join(' ')}>
      {text}
    </td>
  );
}

/**
 * A chart's values as a table.
 * @param {{columns: Array<{label: string, numeric: (boolean|undefined)}>,
 *     rows: Array<Array<(string|number|null|{text: string, inferred: boolean})>>,
 *     caption: (string|undefined)}} props Column headers, one array per row, and an
 *     optional caption read by a screen reader before the table.
 * @returns {!Object} The table, in its own horizontal scroller.
 */
export function TableTwin({ columns, rows, caption }) {
  return (
    <div class="tablewrap">
      <table>
        {caption ? <caption class="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} class={column.numeric ? 'num' : null} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <Cell key={column} cell={cell} numeric={Boolean(columns[column]?.numeric)} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
