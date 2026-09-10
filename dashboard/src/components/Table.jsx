/**
 * A plain data table, used directly by leaderboards and as a chart's table twin.
 *
 * Wrapped in its own horizontally-scrolling box so a wide table never makes the page
 * itself scroll sideways — the one layout rule every page in this dashboard keeps.
 *
 * A column may opt into client-side sorting with `sortable: true`; when no column does,
 * the table renders exactly as a static one and carries no state.
 */

import { useMemo, useState } from 'preact/hooks';

/**
 * Compares two `sortValue` results, always sinking nullish values to the bottom.
 * @param {*} a First value.
 * @param {*} b Second value.
 * @returns {number} Negative when `a` sorts first, positive when `b` does.
 */
function compareValues_(a, b) {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/**
 * The value a row contributes to sorting on a column.
 * @param {{key: string, sortValue?: function(!Object): *}} column The column definition.
 * @param {!Object} row The row.
 * @returns {*} A comparable value.
 */
function sortValueOf_(column, row) {
  return column.sortValue ? column.sortValue(row) : row[column.key];
}

/**
 * Renders a table from column definitions and rows.
 * @param {{columns: Array<{key: string, label: string, numeric?: boolean,
 *     sortable?: boolean, sortValue?: function(!Object): *}>, rows: Array<!Object>,
 *     rowKey?: function(!Object, number): (string|number)}} props
 *     `columns` names each field to show, whether it right-aligns as a number, and whether
 *     it can be sorted (with an optional `sortValue` reading the raw comparable behind a
 *     pre-formatted cell); `rows` are plain objects read by `columns[].key`; `rowKey`
 *     picks a key, defaulting to the row's index.
 * @returns {!preact.VNode} The table, scroll-boxed.
 */
export function DataTable({ columns, rows, rowKey }) {
  const sortableColumns = columns.filter((column) => column.sortable);
  const firstSortable = sortableColumns[0];
  const [sort, setSort] = useState(
    firstSortable
      ? { key: firstSortable.key, dir: firstSortable.numeric ? 'desc' : 'asc' }
      : null
  );

  const onSort = (column) => {
    if (!column.sortable) return;
    setSort((current) =>
      current && current.key === column.key
        ? { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key: column.key, dir: column.numeric ? 'desc' : 'asc' }
    );
  };

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (!column) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return rows
      .map((row, index) => ({ row, index }))
      .sort(
        (a, b) =>
          factor * compareValues_(sortValueOf_(column, a.row), sortValueOf_(column, b.row)) ||
          a.index - b.index
      )
      .map((entry) => entry.row);
  }, [rows, columns, sort]);

  return (
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort && sort.key === column.key;
              return (
                <th
                  key={column.key}
                  class={
                    (column.numeric ? 'num' : '') + (column.sortable ? ' th-sortable' : '')
                  }
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={column.sortable ? () => onSort(column) : undefined}
                >
                  {column.label}
                  {column.sortable ? (
                    <span class="th-sort-indicator">{active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
                  ) : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr key={rowKey ? rowKey(row, index) : index}>
              {columns.map((column) => (
                <td key={column.key} class={column.numeric ? 'num' : ''}>
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
