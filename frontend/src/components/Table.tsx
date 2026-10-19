/**
 * A plain data table in its own horizontal scroller, so a wide table never scrolls the page sideways.
 * A column may opt into client-side sorting with `sortable`; with none, it carries no state.
 */

import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';

/** A sort direction. */
type Direction = 'asc' | 'desc';

/**
 * One column: the row field it shows, whether it right-aligns as a number, and whether it sorts
 * (`sortValue` reads the raw value behind a formatted cell; `defaultDir` is the first direction).
 */
export interface Column<R> {
  key: string;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  sortValue?: (row: R) => unknown;
  defaultDir?: Direction;
}

/** Compares two sort values, always sinking blanks to the bottom. */
function compareValues(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined || a === '';
  const bNull = b === null || b === undefined || b === '';
  if (aNull || bNull) return Number(aNull) - Number(bNull);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** A field of a row, read by name. */
const field = <R,>(row: R, key: string): unknown => (row as Record<string, unknown>)[key];

/** The first direction a column sorts in: its `defaultDir`, else largest first for numbers, A→Z for text. */
function firstDirOf<R>(column: Column<R>): Direction {
  return column.defaultDir ?? (column.numeric ? 'desc' : 'asc');
}

/** A table from column definitions and rows; `rowKey` defaults to the row's index. */
export function DataTable<R extends object>({
  columns,
  rows,
  rowKey,
}: {
  columns: Column<R>[];
  rows: R[];
  rowKey?: (row: R, index: number) => string | number;
}) {
  const firstSortable = columns.find((column) => column.sortable);
  const [sort, setSort] = useState<{ key: string; dir: Direction } | null>(
    firstSortable ? { key: firstSortable.key, dir: firstDirOf(firstSortable) } : null,
  );

  const onSort = (column: Column<R>) => {
    if (!column.sortable) return;
    setSort((current) =>
      current?.key === column.key ? { key: column.key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key: column.key, dir: firstDirOf(column) },
    );
  };

  const sortedRows = useMemo(() => {
    const column = sort && columns.find((candidate) => candidate.key === sort.key);
    if (!sort || !column) return rows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    const valueOf = (row: R) => (column.sortValue ? column.sortValue(row) : field(row, column.key));
    return rows
      .map((row, index) => ({ row, index }))
      .sort((a, b) => factor * compareValues(valueOf(a.row), valueOf(b.row)) || a.index - b.index)
      .map((entry) => entry.row);
  }, [rows, columns, sort]);

  return (
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key ? sort.dir : null;
              return (
                <th
                  key={column.key}
                  class={(column.numeric ? 'num' : '') + (column.sortable ? ' th-sortable' : '')}
                  aria-sort={active ? (active === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={column.sortable ? () => onSort(column) : undefined}
                >
                  {column.label}
                  {column.sortable ? <span class="th-sort-indicator">{active ? (active === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span> : null}
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
                  {field(row, column.key) as ComponentChildren}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
