/**
 * "Type 4D or name to search for soldier" — one soldier's whole record.
 *
 * Absences read newest-first, because the question this page answers is "how has this
 * soldier been lately". The 'Others' table reads the opposite way, oldest-first, because
 * it is a narrative of attachments and duties rather than a history of absence — both
 * orderings come straight from `soldier.js`'s `soldierReport` and are not re-sorted here.
 *
 * The page is one search bar and nothing else to set, like a web search engine: centred
 * on its own until a soldier is picked, then pinned above that soldier's report. It
 * searches the whole battalion rather than following the company selector, since a
 * soldier found by 4D or name already says which company they are in.
 */

import { useMemo, useState } from 'preact/hooks';
import { dataset } from '../app/state.js';
import { Card, Coverage, EmptyState } from '../components/Card.jsx';
import { DataTable } from '../components/Table.jsx';
import { Tile, TileRow } from '../components/Tile.jsx';
import { SoldierSearch } from '../components/SoldierSearch.jsx';
import { fmtDate, fmtInt } from '../format.js';
import { buildEpisodes } from '../model/episodes.js';
import { toSubmissions } from '../model/formsg.js';
import { soldierIndex, soldierReport } from '../model/soldier.js';

/**
 * A ranked reason table, used for the MC / report-sick / status reason breakdowns.
 * @param {{title: string, rows: Array<{reason: string, count: number}>}} props The
 *     panel's title and its ranked reasons.
 * @returns {!preact.VNode} The panel.
 */
function ReasonTable({ title, rows }) {
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

/**
 * The Soldier page.
 * @returns {!preact.VNode} The page.
 */
export function Soldier() {
  const data = dataset.value;
  const [selectedKey, setSelectedKey] = useState(null);

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
