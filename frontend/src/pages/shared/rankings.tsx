/**
 * Ranking and lookup cards for the category pages: clinics, long MC, leaderboards, unit rankings and soldier search.
 */

import { useState } from 'preact/hooks';
import { Card, EmptyState } from '../../components/Card.tsx';
import { DataTable } from '../../components/Table.tsx';
import { SoldierSearch } from '../../components/SoldierSearch.tsx';
import { Leaderboard } from '../../components/Leaderboard.tsx';
import { fmtDate, fmtFraction, fmtInt } from '../../format.ts';
import { Bar, ChartCard } from '../../charts/index.ts';
import { longMcRoster, longMcTrend } from '../../model/metrics.ts';
import { withinRange } from '../../model/dateRange.ts';
import { topByCount, topByDays, topByStatusCount, rankUnits } from '../../model/leaderboards.ts';
import { locationCounts, locationCoverage } from '../../model/locations.ts';
import { toText } from '../../../../shared/values.ts';
import { isDuty } from '../../model/classify.ts';
import type { DutyFilter } from '../../model/metrics.ts';
import type { Episode } from '../../model/episodes.ts';
import type { SoldierEntry } from '../../model/soldier.ts';
import type { UnitRank } from '../../model/leaderboards.ts';
import type { LeaderboardRow } from '../../components/Leaderboard.tsx';
import type { PersonnelRow } from '../../../../shared/dashboard.ts';
import type { CategoryRange } from './category.tsx';
import { settingOf } from '../../model/activeSettings.ts';

/**
 * The leaderboard each metric draws: its card title, its ranking, and the column set `Leaderboard` renders
 * for it.
 */
const LEADERBOARDS: Record<'count' | 'days' | 'status', { title: string; top: (episodes: Episode[], dutyClass: DutyFilter) => LeaderboardRow[] }> = {
  count: { title: 'Episode Count', top: (episodes, dutyClass) => topByCount(episodes, dutyClass) },
  days: { title: 'Days Lost', top: (episodes, dutyClass) => topByDays(episodes, dutyClass) },
  status: { title: 'Statuses Held', top: (episodes) => topByStatusCount(episodes) },
};

/**
 * Clinic-ranking bars for MC and MA, drawn separately since their location coverage differs sharply (88% on
 * MA, 17% on MC in the observed data). Only parade states inside the range count, like every other section on
 * the page.
 */
export function LocationsCard({ personnel: all, range }: { personnel: PersonnelRow[]; range: CategoryRange }) {
  const personnel = all.filter((row) => withinRange(row.date, range.from, range.to));
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
        <Bar categories={mcCounts.map((entry) => entry.location)} values={mcCounts.map((entry) => entry.count)} valueName="visits" />
      </ChartCard>
      <ChartCard
        title="Top MA Clinics"
        coverage={'Location stated on ' + fmtFraction(ma.withLocation, ma.total) + ' of MA rows.'}
        empty="No location recorded on any MA row in range."
      >
        <Bar categories={maCounts.map((entry) => entry.location)} values={maCounts.map((entry) => entry.count)} valueName="visits" />
      </ChartCard>
    </div>
  );
}

/** The long-term MC panel: peak count and roster of episodes of at least the Thresholds long-MC length. */
export function LongMcCard({ episodes, range }: { episodes: Episode[]; range: CategoryRange }) {
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

/** The top soldiers (Thresholds leaderboard size) for one duty class over the range. */
export function EpisodeLeaderboard({ range, dutyClass, metric }: { range: CategoryRange; dutyClass: DutyFilter; metric: 'count' | 'days' | 'status' }) {
  const board = LEADERBOARDS[metric];
  return (
    <Card title={`Top ${settingOf('thresholds').leaderboardSize} by ${board.title}`}>
      <Leaderboard rows={board.top(range.episodes, dutyClass)} metric={metric} />
    </Card>
  );
}

/**
 * The company and platoon rankings, side by side: episodes in range, and the distinct soldiers behind them.
 */
export function UnitRankings({
  range,
  dutyClass,
  labels,
}: {
  range: Pick<CategoryRange, 'episodes'>;
  dutyClass: DutyFilter;
  labels: { count: string; soldiers: string };
}) {
  const companies = rankUnits(range.episodes, dutyClass, 'company');
  const platoons = rankUnits(range.episodes, dutyClass, 'platoon');
  const countColumns = [
    { key: 'count', label: labels.count, numeric: true, sortable: true, sortValue: (row: UnitRow) => row.raw.count },
    { key: 'soldiers', label: labels.soldiers, numeric: true, sortable: true, sortValue: (row: UnitRow) => row.raw.soldiers },
  ];
  const toRow = (row: UnitRank): UnitRow => ({ ...row, count: fmtInt(row.count), soldiers: fmtInt(row.soldiers), raw: row });

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

/** A unit's formatted counts, keeping the raw ones to sort by. */
type UnitRow = Omit<UnitRank, 'count' | 'soldiers'> & { count: string; soldiers: string; raw: UnitRank };

/** Soldier search, and the picked soldier's episodes of this duty class. */
export function SoldierLookup({ index, episodes, dutyClass }: { index: SoldierEntry[]; episodes: Episode[]; dutyClass: DutyFilter }) {
  const [soldierKey, setSoldierKey] = useState<string | null>(null);
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
