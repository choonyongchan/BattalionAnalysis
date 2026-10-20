/**
 * Report Sick Compliance: does every soldier the parade state lists as reporting sick file the FormSG?
 * Names are matched per day by `model/compliance.ts`; the page follows the company and date controls.
 */

import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';
import { ChartCard, Sankey } from '../charts/index.ts';
import { Card, EmptyState } from '../components/Card.tsx';
import { DataTable, type Column } from '../components/Table.tsx';
import { Tile, TileRow } from '../components/Tile.tsx';
import { fmtDate, fmtInt, fmtPercent } from '../format.ts';
import { reportSickCompliance, type ComplianceRow } from '../model/compliance.ts';
import { CategoryPage, useCategory } from './shared/category.tsx';

/** A list row as shown: the date formatted, the name highlighted. */
type ShownRow = Omit<ComplianceRow, 'name'> & { day: string; name: ComponentChildren };

/** The soldier list's columns, newest first. */
const COLUMNS: Column<ShownRow>[] = [
  { key: 'day', label: 'Date', sortable: true, sortValue: (row) => row.date, defaultDir: 'desc' },
  { key: 'company', label: 'Company', sortable: true },
  { key: 'rank', label: 'Rank' },
  { key: 'name', label: 'Name' },
  { key: 'fourD', label: '4D' },
];

/** A soldier list with the name in a highlight colour. */
function SoldierList({ title, note, rows, tone }: { title: string; note: string; rows: ComplianceRow[]; tone: 'critical' | 'warning' }) {
  return (
    <Card title={title} note={note}>
      {rows.length === 0 ? (
        <EmptyState>Nobody in this range.</EmptyState>
      ) : (
        <DataTable
          columns={COLUMNS}
          rows={rows.map((row) => ({ ...row, day: fmtDate(row.date), name: <span class={'msgstatus__label--' + tone}>{row.name}</span> }))}
        />
      )}
    </Card>
  );
}

/** The Report Sick Compliance page. */
export function Compliance() {
  const { data, submissions, range } = useCategory();
  const result = useMemo(
    () => reportSickCompliance(data.personnel, submissions, range.from, range.to),
    [data.personnel, submissions, range.from, range.to]
  );
  const onParade = result.matched + result.missing.length;

  return (
    <CategoryPage title="Report Sick Compliance" range={range}>
      <TileRow>
        <Tile label="Compliance" value={fmtPercent(result.compliance)} foot="Reporting sick on the parade state who filed FormSG" />
        <Tile label="Reporting sick (parade state)" value={fmtInt(onParade)} />
        <Tile label="No FormSG" value={fmtInt(result.missing.length)} />
        <Tile label="FormSG only" value={fmtInt(result.formOnly.length)} foot="Not on that day's parade state" />
      </TileRow>
      <ChartCard
        title="Parade State to FormSG"
        note="Matched by name on the same day: 4D first, then name, tolerating preferred names and typos."
        coverage={`${fmtInt(result.matched)} matched, ${fmtInt(result.missing.length)} with no FormSG, ${fmtInt(result.formOnly.length)} on FormSG only.`}
      >
        <Sankey nodes={result.nodes} links={result.links} height={320} />
      </ChartCard>
      <SoldierList
        title="Failed Compliance"
        note="Reporting sick on the parade state with no FormSG that day."
        rows={result.missing}
        tone="critical"
      />
      <SoldierList
        title="On FormSG, Not on Parade State"
        note="Filed FormSG but not listed as reporting sick on that day's parade state."
        rows={result.formOnly}
        tone="warning"
      />
    </CategoryPage>
  );
}
