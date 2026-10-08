/**
 * Ranking and lookup cards for the category pages: clinics, long MC, leaderboards, unit rankings and soldier search.
 */

import { useState } from 'preact/hooks';
import { Card, EmptyState } from '../../components/Card.jsx';
import { DataTable } from '../../components/Table.jsx';
import { SoldierSearch } from '../../components/SoldierSearch.jsx';
import { Leaderboard } from '../../components/Leaderboard.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../../format.js';
import { Bar, ChartCard } from '../../charts/index.js';
import { longMcRoster, longMcTrend } from '../../model/metrics.js';
import { withinRange } from '../../model/dateRange.js';
import { topByCount, topByDays, topByStatusCount, rankUnits } from '../../model/leaderboards.js';
import { locationCounts, locationCoverage } from '../../model/locations.js';
import { toIsoDate, toText } from '../../../../shared/values.js';
import { isDuty } from '../../model/classify.js';
import { settingOf } from '../../model/activeSettings.js';

/**
 * The leaderboard each metric draws: its card title, its ranking, and the column set
 * `Leaderboard` renders for it.
 * @type {!Object<string, {title: string, top: function(Array<!Object>, string): Array<!Object>}>}
 */
const LEADERBOARDS = {
  count: { title: 'Episode Count', top: (episodes, dutyClass) => topByCount(episodes, dutyClass) },
  days: { title: 'Days Lost', top: (episodes, dutyClass) => topByDays(episodes, dutyClass) },
  status: { title: 'Statuses Held', top: (episodes) => topByStatusCount(episodes) },
};

/**
 * Clinic-ranking bars for MC and MA, drawn separately since their location coverage
 * differs sharply (88% on MA, 17% on MC in the observed data). Only parade states inside
 * the range count, like every other section on the page.
 * @param {{personnel: Array<!Object>, range: !Object}} props Personnel rows and the range.
 * @returns {!preact.VNode} The cards.
 */
export function LocationsCard({ personnel: all, range }) {
  const personnel = all.filter((row) => withinRange(toIsoDate(row.date), range.from, range.to));
  const mc = locationCoverage(personnel, 'Att C');
  const ma = locationCoverage(personnel, 'MA');
  const mcCounts = locationCounts(personnel, { category: 'Att C' }).slice(0, 10);
  const maCounts = locationCounts(personnel, { category: 'MA' }).slice(0, 10);

  return (
    <div class="grid-2">
      <ChartCard
        title="Top MC Clinics"
        coverage={'Location stated on ' + fmtFraction(mc.withLocation, mc.total) + ' of Att C rows.'}
        empty="No location recorded on any Att C row in range."
      >
        <Bar categories={mcCounts.map((c) => c.location)} values={mcCounts.map((c) => c.count)} valueName="visits" />
      </ChartCard>
      <ChartCard
        title="Top MA Clinics"
        coverage={'Location stated on ' + fmtFraction(ma.withLocation, ma.total) + ' of MA rows.'}
        empty="No location recorded on any MA row in range."
      >
        <Bar categories={maCounts.map((c) => c.location)} values={maCounts.map((c) => c.count)} valueName="visits" />
      </ChartCard>
    </div>
  );
}

/**
 * The long-term MC panel: peak count and roster of episodes of at least the Thresholds
 * long-MC length.
 * @param {{episodes: Array<!Object>, range: !Object}} props All episodes (a long MC that
 *     started before the range still counts toward its peak), and the range.
 * @returns {!preact.VNode} The card.
 */
export function LongMcCard({ episodes, range }) {
  const longMcDays = settingOf('thresholds').longMcDays;
  const trend = longMcTrend(episodes, range.from, range.to, 'Att C', longMcDays - 1);
  const roster = longMcRoster(episodes, 'Att C', longMcDays - 1);
  const peak = trend.reduce((max, day) => Math.max(max, day.count), 0);

  return (
    <Card title={'Long-Term MC (≥' + longMcDays + ' days)'} note={fmtInt(peak) + ' soldiers at the peak'}>
      {roster.length === 0 ? (
        <EmptyState>No MC in range lasts {longMcDays} days or longer.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'company', label: 'Company' },
            { key: 'platoon', label: 'Platoon' },
            { key: 'days', label: 'Days', numeric: true },
            { key: 'start', label: 'Start' },
            { key: 'end', label: 'End' },
          ]}
          rows={roster.map((row) => ({
            ...row,
            days: fmtInt(row.days),
            start: fmtDate(row.startDate),
            end: fmtDate(row.endDate),
          }))}
          rowKey={(row) => row.key + row.startDate}
        />
      )}
    </Card>
  );
}

/**
 * The top-10 soldiers for one duty class over the range.
 * @param {{range: !Object, dutyClass: (string|!Array<string>), metric: string}} props The range, the duty
 *     class, and 'count', 'days' or 'status' (a key of LEADERBOARDS).
 * @returns {!preact.VNode} The card.
 */
export function EpisodeLeaderboard({ range, dutyClass, metric }) {
  const board = LEADERBOARDS[metric];
  return (
    <Card title={'Top 10 by ' + board.title}>
      <Leaderboard rows={board.top(range.episodes, dutyClass)} metric={metric} />
    </Card>
  );
}

/**
 * The company and platoon rankings, side by side: episodes in range, and the distinct
 * soldiers behind them.
 * @param {{range: !Object, dutyClass: (string|!Array<string>), labels: {count: string,
 *     soldiers: string}}} props The range, the duty class, and the two column headings.
 * @returns {!preact.VNode} The cards.
 */
export function UnitRankings({ range, dutyClass, labels }) {
  const companies = rankUnits(range.episodes, dutyClass, 'company');
  const platoons = rankUnits(range.episodes, dutyClass, 'platoon');
  const countColumns = [
    { key: 'count', label: labels.count, numeric: true, sortable: true, sortValue: (r) => r.countRaw },
    { key: 'soldiers', label: labels.soldiers, numeric: true, sortable: true, sortValue: (r) => r.soldiersRaw },
  ];
  const toRow = (row) => ({
    ...row,
    count: fmtInt(row.count),
    countRaw: row.count,
    soldiers: fmtInt(row.soldiers),
    soldiersRaw: row.soldiers,
  });

  return (
    <div class="grid-2">
      <Card title="Companies, by Count">
        {companies.length === 0 ? (
          <EmptyState>No data in range.</EmptyState>
        ) : (
          <DataTable
            columns={[{ key: 'company', label: 'Company' }, ...countColumns]}
            rows={companies.map(toRow)}
            rowKey={(row) => row.company}
          />
        )}
      </Card>
      <Card title="Platoons, by Count">
        {platoons.length === 0 ? (
          <EmptyState>No data in range.</EmptyState>
        ) : (
          <DataTable
            columns={[{ key: 'company', label: 'Company' }, { key: 'platoon', label: 'Platoon' }, ...countColumns]}
            rows={platoons.map(toRow)}
            rowKey={(row) => row.company + row.platoon}
          />
        )}
      </Card>
    </div>
  );
}

/**
 * Soldier search, and the picked soldier's episodes of this duty class.
 * @param {{index: !Object, episodes: Array<!Object>, dutyClass: (string|!Array<string>)}} props The soldier
 *     index, all episodes, and the duty class to list.
 * @returns {!preact.VNode} The search card, plus the history card once a soldier is picked.
 */
export function SoldierLookup({ index, episodes, dutyClass }) {
  const [soldierKey, setSoldierKey] = useState(null);
  const rows = soldierKey
    ? episodes
        .filter((episode) => episode.key === soldierKey && isDuty(dutyClass, episode.dutyClass))
        .sort((a, b) => toText(b.startDate).localeCompare(toText(a.startDate)))
    : [];

  return (
    <>
      <Card title="Soldier Search">
        <SoldierSearch index={index} onSelect={(soldier) => setSoldierKey(soldier.key)} />
      </Card>
      {soldierKey ? (
        <Card title="This Soldier's History">
          {rows.length === 0 ? (
            <EmptyState>No episodes of this kind on record for this soldier.</EmptyState>
          ) : (
            <DataTable
              columns={[
                { key: 'start', label: 'Start' },
                { key: 'end', label: 'End' },
                { key: 'days', label: 'Days', numeric: true },
                { key: 'reason', label: 'Reason' },
              ]}
              rows={rows.map((row) => ({
                start: fmtDate(row.startDate),
                end: fmtDate(row.endDate),
                days: fmtInt(row.daysLost),
                reason: row.reasons.join('; ') || '—',
              }))}
            />
          )}
        </Card>
      ) : null}
    </>
  );
}
