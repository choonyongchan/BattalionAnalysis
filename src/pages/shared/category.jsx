/**
 * The sections Report Sick, MC/MA and Status are built from.
 *
 * The three pages ask the same four questions — is it trending, which company, which
 * platoon, who most often — so they share these sections rather than each drawing its own.
 * Each page lists the sections it shows, in order; there are no on/off flags to decode.
 *
 * `useCategory` supplies what every section reads: the company-scoped data and the active
 * date range. Every section that is range-bound takes that `range`, so none of them can
 * outlive the range control.
 *
 * This file composes `model/` functions; it computes nothing of its own that a test
 * elsewhere does not already own.
 */

import { useMemo, useState } from 'preact/hooks';
import { company, dataset, dateFrom, dateTo } from '../../app/state.js';
import { Card, EmptyState } from '../../components/Card.jsx';
import { DataTable } from '../../components/Table.jsx';
import { Tile, TileRow } from '../../components/Tile.jsx';
import { Segmented, SCOPE_OPTIONS } from '../../components/Segmented.jsx';
import { PageControls } from '../../components/PageControls.jsx';
import { SoldierSearch } from '../../components/SoldierSearch.jsx';
import { Leaderboard } from '../../components/Leaderboard.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../../format.js';
import { Bar, ChartCard, GroupedBar, Heatmap, Line } from '../../charts/index.js';
import { COMPANIES, PLATOONS, UNASSIGNED } from '../../model/domain.js';
import { ALL_COMPANIES, scopeDataset, scopeSubmissions } from '../../model/scope.js';
import { toHolidays, holidaysIn, weekendBands } from '../../model/calendarMarks.js';
import { GRANULARITIES } from '../../model/buckets.js';
import { toRotations } from '../../model/rotations.js';
import { buildEpisodes } from '../../model/episodes.js';
import { toSubmissions } from '../../model/formsg.js';
import { soldierIndex } from '../../model/soldier.js';
import { datesPresent, episodeCounts, longMcRoster, longMcTrend } from '../../model/metrics.js';
import { eachDay, isoToday, withinRange } from '../../model/dateRange.js';
import { dutyTrend } from '../../model/strength.js';
import { topByCount, topByDays, topByStatusCount, rankUnits } from '../../model/leaderboards.js';
import { topLabelsOverTime } from '../../model/reasonTrend.js';
import { locationCounts, locationCoverage } from '../../model/locations.js';
import { toText } from '../../model/values.js';

/** @type {number} Days an Att C episode must exceed to count as long-term MC. */
const LONG_MC_MIN_DAYS = 13;

/**
 * The leaderboard each metric draws: its card title, its ranking, and the column set
 * `Leaderboard` renders for it.
 * @type {!Object<string, {title: string, top: function(Array<!Object>, string): Array<!Object>}>}
 */
const LEADERBOARDS = {
  count: { title: 'Episode Count', top: (episodes, dutyClass) => topByCount(episodes, dutyClass, 10) },
  days: { title: 'Days Lost', top: (episodes, dutyClass) => topByDays(episodes, dutyClass, 10) },
  status: { title: 'Statuses Held', top: (episodes) => topByStatusCount(episodes, 10) },
};

/**
 * Everything a category page reads: the company-scoped data and the active date range.
 *
 * The range bounds come from the full, unscoped parade dates so the picker and trend axis
 * do not contract when a company that filed on fewer days is picked.
 * @returns {{data: !Object, episodes: Array<!Object>, submissions: Array<!Object>,
 *     index: !Object, range: {from: string, to: string, min: string, max: string,
 *     days: string[], weekends: Array<!Object>, holidays: Array<!Object>,
 *     rotations: Array<!Object>, episodes: Array<!Object>}}} The scoped data, its soldier
 *     index, and the range with its trend days, annotations and in-range episodes.
 */
export function useCategory() {
  const full = dataset.value;
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const paradeDates = useMemo(() => datesPresent(full.strength), [full.strength]);
  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const submissions = useMemo(
    () => scopeSubmissions(toSubmissions(data.formSg), company.value),
    [data.formSg, company.value]
  );
  const index = useMemo(() => soldierIndex(data.personnel, submissions), [data.personnel, submissions]);
  const holidays = useMemo(() => toHolidays(data.holidays), [data.holidays]);
  const rotations = useMemo(() => toRotations(data.rotations), [data.rotations]);

  const min = paradeDates[0] || isoToday();
  const max = paradeDates[paradeDates.length - 1] || isoToday();
  const from = dateFrom.value || min;
  const to = dateTo.value || max;
  const range = useMemo(
    () => ({
      from,
      to,
      min,
      max,
      days: eachDay(from, to),
      weekends: weekendBands(from, to),
      holidays: holidaysIn(holidays, from, to),
      rotations,
      episodes: episodes.filter((episode) => episode.startDate && withinRange(episode.startDate, from, to)),
    }),
    [from, to, min, max, holidays, rotations, episodes]
  );

  return { data, episodes, submissions, index, range };
}

/**
 * The page title, the range it covers, and the company + date bar.
 * @param {{title: string, range: !Object, children: *}} props The title, the range from
 *     `useCategory`, and the page's sections.
 * @returns {!preact.VNode} The page.
 */
export function CategoryPage({ title, range, children }) {
  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">{title}</h1>
          <p class="pagehead__sub">{fmtDate(range.from)} – {fmtDate(range.to)}</p>
        </div>
      </header>
      <PageControls min={range.min} max={range.max} />
      {children}
    </div>
  );
}

/**
 * Episodes, soldiers and episodes per soldier for one duty class, over the range.
 * @param {{range: !Object, dutyClass: string, labels?: {episodes?: string,
 *     soldiers?: string, perSoldier?: string}}} props The range, the duty class, and
 *     optional tile labels.
 * @returns {!preact.VNode} The tile row.
 */
export function EpisodeTiles({ range, dutyClass, labels = {} }) {
  const { total } = episodeCounts(range.episodes, dutyClass);
  return (
    <TileRow>
      <Tile label={labels.episodes || 'Episodes'} value={fmtInt(total.episodes)} />
      <Tile label={labels.soldiers || 'Soldiers'} value={fmtInt(total.soldiers)} />
      <Tile
        label={labels.perSoldier || 'Episodes per soldier'}
        value={total.perSoldier === null ? '—' : total.perSoldier.toFixed(1)}
      />
    </TileRow>
  );
}

/**
 * One trend card: a Battalion/Companies toggle over a Line chart.
 *
 * A real component rather than a helper called as a function, so its `useState` for the
 * scope toggle owns a hook slot of its own. With a single company selected in the page
 * bar the toggle has nothing to switch between, so it is hidden and the chart draws that
 * company's one line in its own colour slot.
 * @param {{title: string, coverage: string, trendFn: function(string, string[]): !Object,
 *     range: !Object}} props The card's title and coverage line; `trendFn(scope, dates)`
 *     returns `{dates, series}`; the range supplies the dates and annotations.
 * @returns {!preact.VNode} The card.
 */
export function TrendSection({ title, coverage, trendFn, range }) {
  const scopedCompany = company.value !== ALL_COMPANIES ? company.value : null;
  const [scope, setScope] = useState('battalion');
  const effectiveScope = scopedCompany ? 'battalion' : scope;
  const trend = trendFn(effectiveScope, range.days);

  return (
    <Card title={title}>
      {scopedCompany ? null : (
        <div class="controlrow">
          <Segmented options={SCOPE_OPTIONS} value={scope} onChange={setScope} label="Chart scope" />
        </div>
      )}
      <ChartCard title="" coverage={coverage}>
        <Line
          categories={trend.dates}
          series={trend.series.map((series) => ({
            ...series,
            name: scopedCompany || series.name,
            slot: scopedCompany
              ? COMPANIES.indexOf(scopedCompany)
              : effectiveScope === 'companies'
                ? COMPANIES.indexOf(series.name)
                : undefined,
            neutral: !scopedCompany && effectiveScope === 'battalion',
          }))}
          weekends={range.weekends}
          holidays={range.holidays}
          valueName="per 100"
        />
      </ChartCard>
      {!scopedCompany && effectiveScope === 'companies' ? (
        <p class="chart-hint">Tap on the company to hide</p>
      ) : null}
    </Card>
  );
}

/**
 * The parade-state rate trend of one duty class.
 * @param {{title: string, data: !Object, dutyClass: string, range: !Object}} props The
 *     card title, the scoped dataset, the duty class, and the range.
 * @returns {!preact.VNode} The card.
 */
export function DutyTrend({ title, data, dutyClass, range }) {
  return (
    <TrendSection
      title={title}
      coverage="Rate per 100 accountable; a company not filing that day is a gap."
      trendFn={(scope, dates) =>
        dutyTrend(data.personnel, data.strength, dutyClass, dates, { scope, session: 'FPS' })
      }
      range={range}
    />
  );
}

/**
 * Counts episodes of one duty class per company x platoon for the heatmap grid.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string} dutyClass Duty class to keep, from DUTY_CLASS.
 * @returns {Array<{row: string, column: string, value: number}>} Non-empty cells only.
 */
export function episodeCells(episodes, dutyClass) {
  const counts = new Map();
  episodes
    .filter((episode) => episode.dutyClass === dutyClass)
    .forEach((episode) => {
      const key = episode.company + '\u0000' + (episode.platoon || UNASSIGNED);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  const cells = [];
  COMPANIES.forEach((row) => {
    PLATOONS.forEach((column) => {
      const value = counts.get(row + '\u0000' + column);
      if (value) {
        cells.push({ row, column, value });
      }
    });
  });
  return cells;
}

/**
 * The Company x Platoon heatmap.
 * @param {{cells: Array<{row: string, column: string, value: number}>, title?: string,
 *     coverage?: string, valueName?: string, empty?: string}} props The cells, from
 *     `episodeCells` or another source, and the card's wording.
 * @returns {!preact.VNode} The card.
 */
export function PlatoonHeatmap({
  cells,
  title = 'By Company and Platoon',
  coverage = 'Count of episodes; a bare platoon axis, not a rate — see the table for totals.',
  valueName = 'episodes',
  empty = 'No episodes in range to place on the grid.',
}) {
  return (
    <ChartCard title={title} coverage={coverage} empty={empty}>
      <Heatmap rows={COMPANIES} columns={PLATOONS} cells={cells} valueName={valueName} />
    </ChartCard>
  );
}

/**
 * The reasons-over-time grouped bar, with its own granularity radio.
 * @param {{rows: Array<!Object>, dateOf: function(!Object): ?string,
 *     labelsOf: function(!Object): string[], range: !Object, title?: string}} props The
 *     rows to chart, how to read each one's date and labels, and the range to keep.
 * @returns {!preact.VNode} The card.
 */
export function ReasonsOverTime({ rows, dateOf, labelsOf, range, title = 'Top Reasons Over Time' }) {
  const [granularity, setGranularity] = useState('daily');
  // `dateOf`/`labelsOf` are left out of the deps: pages pass fresh arrows each render
  // with the same meaning, and keying on them would recompute on every render.
  const trend = useMemo(() => {
    const items = rows
      .filter((row) => withinRange(dateOf(row), range.from, range.to))
      .map((row) => ({ date: dateOf(row), labels: labelsOf(row) }));
    return topLabelsOverTime(items, granularity, range.rotations, 5);
  }, [rows, range, granularity]);

  return (
    <Card title={title}>
      <div class="controlrow">
        <Segmented
          options={GRANULARITIES}
          value={granularity}
          onChange={setGranularity}
          label="Group dates by"
          radio
        />
      </div>
      <ChartCard title="" empty="No reasons recorded in range.">
        <GroupedBar categories={trend.categories} series={trend.series} />
      </ChartCard>
    </Card>
  );
}

/**
 * Clinic-ranking bars for MC and MA, drawn separately since their location coverage
 * differs sharply (88% on MA, 17% on MC in the observed data).
 * @param {{personnel: Array<!Object>}} props Personnel rows.
 * @returns {!preact.VNode} The cards.
 */
export function LocationsCard({ personnel }) {
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
 * The long-term MC panel: peak count and roster of episodes exceeding 13 days.
 * @param {{episodes: Array<!Object>, range: !Object}} props All episodes (a long MC that
 *     started before the range still counts toward its peak), and the range.
 * @returns {!preact.VNode} The card.
 */
export function LongMcCard({ episodes, range }) {
  const trend = longMcTrend(episodes, range.from, range.to, 'Att C', LONG_MC_MIN_DAYS);
  const roster = longMcRoster(episodes, 'Att C', LONG_MC_MIN_DAYS);
  const peak = trend.reduce((max, day) => Math.max(max, day.count), 0);

  return (
    <Card title={'Long-Term MC (≥' + (LONG_MC_MIN_DAYS + 1) + ' days)'} note={fmtInt(peak) + ' soldiers at the peak'}>
      {roster.length === 0 ? (
        <EmptyState>No MC in range runs longer than {LONG_MC_MIN_DAYS + 1} days.</EmptyState>
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
 * @param {{range: !Object, dutyClass: string, metric: string}} props The range, the duty
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
 * The company and platoon rate rankings, side by side.
 * @param {{data: !Object, dutyClass: string}} props The scoped dataset and duty class.
 * @returns {!preact.VNode} The cards.
 */
export function UnitRankings({ data, dutyClass }) {
  const companies = rankUnits(data.personnel, data.strength, dutyClass, 'company');
  const platoons = rankUnits(data.personnel, data.strength, dutyClass, 'platoon');

  return (
    <div class="grid-2">
      <Card title="Companies, by Rate">
        {companies.length === 0 ? (
          <EmptyState>No data in range.</EmptyState>
        ) : (
          <DataTable
            columns={[
              { key: 'company', label: 'Company' },
              { key: 'per100', label: 'Rate per 100', numeric: true },
              { key: 'days', label: 'Days', numeric: true },
            ]}
            rows={companies.map((row) => ({ ...row, per100: fmtInt(row.per100), days: fmtInt(row.days) }))}
            rowKey={(row) => row.company}
          />
        )}
      </Card>
      <Card title="Platoons, by Rate">
        {platoons.length === 0 ? (
          <EmptyState>No data in range.</EmptyState>
        ) : (
          <DataTable
            columns={[
              { key: 'company', label: 'Company' },
              { key: 'platoon', label: 'Platoon' },
              { key: 'per100', label: 'Rate per 100', numeric: true },
            ]}
            rows={platoons.map((row) => ({ ...row, per100: fmtInt(row.per100) }))}
            rowKey={(row) => row.company + row.platoon}
          />
        )}
      </Card>
    </div>
  );
}

/**
 * Soldier search, and the picked soldier's episodes of this duty class.
 * @param {{index: !Object, episodes: Array<!Object>, dutyClass: string}} props The soldier
 *     index, all episodes, and the duty class to list.
 * @returns {!preact.VNode} The search card, plus the history card once a soldier is picked.
 */
export function SoldierLookup({ index, episodes, dutyClass }) {
  const [soldierKey, setSoldierKey] = useState(null);
  const rows = soldierKey
    ? episodes
        .filter((episode) => episode.key === soldierKey && episode.dutyClass === dutyClass)
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
