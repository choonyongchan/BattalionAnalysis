/**
 * One soldier's whole record, found by 4D or name across the battalion (it ignores the company selector).
 * Absences read newest first; "Others" entries read oldest first, as a narrative.
 */

import { useMemo, useState } from 'preact/hooks';
import { loadedData } from '../app/state.ts';
import { Card, Coverage, EmptyState } from '../components/Card.tsx';
import { DataTable } from '../components/Table.tsx';
import { Tile, TileRow } from '../components/Tile.tsx';
import { SoldierSearch } from '../components/SoldierSearch.tsx';
import { fmtDate, fmtInt } from '../format.ts';
import { ChartCard, Timeline } from '../charts/index.ts';
import { buildEpisodes } from '../model/episodes.ts';
import { toSubmissions } from '../model/formsg.ts';
import { soldierIndex, soldierReport } from '../model/soldier.ts';

/** A ranked reason table, used for the MC / report-sick / status reason breakdowns. */
function ReasonTable({ title, rows }: { title: string; rows: { reason: string; count: number }[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <EmptyState>No {title.toLowerCase()} recorded.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'reason', label: 'Reason' },
            { key: 'count', label: 'Count', numeric: true },
          ]}
          rows={rows.map((row) => ({ reason: row.reason, count: fmtInt(row.count) }))}
          rowKey={(row) => row.reason}
        />
      )}
    </Card>
  );
}

/** The Soldier page. */
export function Soldier() {
  const data = loadedData();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const submissions = useMemo(() => toSubmissions(data.formSg), [data.formSg]);
  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const index = useMemo(() => soldierIndex(data.personnel, submissions), [data.personnel, submissions]);

  const report = selectedKey
    ? soldierReport(selectedKey, { personnel: data.personnel, episodes, submissions })
    : null;

  // One tree for both layouts, so the search bar keeps what was typed when a soldier is
  // picked and the page moves from the centred landing view to the report.
  return (
    <div class={report ? 'page' : 'soldierhome'}>
      <h1 class={report ? 'visually-hidden' : 'soldierhome__title'}>Soldier</h1>
      <SoldierSearch index={index} autoFocus onSelect={(soldier) => setSelectedKey(soldier.key)} />

      {!report ? (
        <p class="soldierhome__hint">Type a 4D or a name to see that soldier's record.</p>
      ) : (
        <div class="page">
          <TileRow>
            <Tile label="Report sick" value={fmtInt(report.counts.reportSick)} />
            <Tile label="MA" value={fmtInt(report.counts.ma)} />
            <Tile label="MC" value={fmtInt(report.counts.mc)} />
            <Tile label="Off/Leave" value={fmtInt(report.counts.offLeave)} />
            <Tile label="Statuses held" value={fmtInt(report.counts.statuses)} />
          </TileRow>

          {report.identitySource === 'name' ? (
            <Coverage>
              Matched by name only — no 4D was on record. Two soldiers sharing a name would
              merge here.
            </Coverage>
          ) : null}

          <ChartCard
            title="MC and Leave Over Time"
            coverage="Each bar runs from the first to the last day stated on the parade state; an episode with no end date is left off."
            empty="No MC or Off/Leave with both dates recorded."
          >
            <Timeline
              lanes={['MC', 'Off/Leave']}
              spans={report.absences.flatMap(({ dutyClass, startDate, endDate, days, reason }) =>
                startDate && endDate
                  ? [{ lane: dutyClass === 'Att C' ? 'MC' : 'Off/Leave', start: startDate, end: endDate, days, label: reason }]
                  : [],
              )}
            />
          </ChartCard>

          <Card title="MC and Off/Leave History" note="Most recent first">
            {report.absences.length === 0 ? (
              <EmptyState>No MC or Off/Leave recorded.</EmptyState>
            ) : (
              <DataTable
                columns={[
                  { key: 'dutyClass', label: 'Type' },
                  { key: 'startDate', label: 'Start' },
                  { key: 'endDate', label: 'End' },
                  { key: 'days', label: 'Days', numeric: true },
                  { key: 'reason', label: 'Reason' },
                ]}
                rows={report.absences.map((absence) => ({
                  dutyClass: absence.dutyClass === 'Att C' ? 'MC' : absence.dutyClass,
                  startDate: fmtDate(absence.startDate),
                  endDate: fmtDate(absence.endDate),
                  days: fmtInt(absence.days),
                  reason: absence.reason || '—',
                }))}
                rowKey={(row, index) => row.startDate + index}
              />
            )}
          </Card>

          <div class="grid-2">
            <ReasonTable title="Common MC Reasons" rows={report.reasonTables.mc} />
            <ReasonTable title="Common Report-Sick Reasons" rows={report.reasonTables.reportSick} />
          </div>
          <ReasonTable title="Common Status Reasons" rows={report.reasonTables.status} />

          <Card title="FormSG Submissions">
            {report.formSg.length === 0 ? (
              <EmptyState>No FormSG report-sick submissions on record for this soldier.</EmptyState>
            ) : (
              <DataTable
                columns={[
                  { key: 'date', label: 'Date' },
                  { key: 'type', label: 'Type' },
                  { key: 'reason', label: 'Reason' },
                ]}
                rows={report.formSg.map((entry) => ({
                  date: fmtDate(entry.date),
                  type: entry.type || '—',
                  reason: entry.reason || '—',
                }))}
                rowKey={(row, index) => row.date + index}
              />
            )}
          </Card>

          <Card title="Other Entries" note="Oldest first">
            {report.others.length === 0 ? (
              <EmptyState>No "Others" entries recorded for this soldier.</EmptyState>
            ) : (
              <DataTable
                columns={[
                  { key: 'date', label: 'Date' },
                  { key: 'reason', label: 'Reason' },
                  { key: 'location', label: 'Location' },
                ]}
                rows={report.others.map((entry) => ({
                  date: fmtDate(entry.date),
                  reason: entry.reason || '—',
                  location: entry.location || '—',
                }))}
                rowKey={(row, index) => row.date + index}
              />
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
