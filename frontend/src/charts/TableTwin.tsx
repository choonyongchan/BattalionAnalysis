/**
 * The table half of every chart card: the accessible equivalent of colour and position, and what S1
 * copies into a brief. Each chart builds it from the props it draws, so the two views cannot disagree.
 * An `{text, inferred: true}` cell takes the same hatch the Heatmap draws over an inferred value.
 */

/** A table cell; a missing value shows as an em dash. */
export type TableCell = string | number | null | undefined | { text: string | number | null; inferred: boolean };

/** A column header. */
export interface TableColumn {
  label: string;
  numeric?: boolean;
}

/** One cell. */
function Cell({ cell, numeric }: { cell: TableCell; numeric: boolean }) {
  const value = cell !== null && typeof cell === 'object' ? cell : { text: cell, inferred: false };
  const text = value.text === null || value.text === undefined || value.text === '' ? '—' : String(value.text);
  return <td class={[numeric ? 'num' : '', value.inferred ? 'inferred' : ''].filter(Boolean).join(' ')}>{text}</td>;
}

/** A chart's values as a table in its own scroller; `caption` is read by screen readers first. */
export function TableTwin({ columns, rows, caption }: { columns: TableColumn[]; rows: TableCell[][]; caption?: string }) {
  return (
    <div class="tablewrap">
      <table>
        {caption ? <caption class="visually-hidden">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.label} class={column.numeric ? 'num' : undefined} scope="col">
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
