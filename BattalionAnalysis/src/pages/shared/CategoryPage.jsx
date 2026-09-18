/**
 * The renderer Report Sick, MC/MA and Status all share.
 *
 * The three pages ask the same four questions — is it trending, which company, which
 * platoon, who most often — so one renderer answers them, parameterised per category by
 * a spec object exactly as the previous implementation was.
 * Everything unique to one page (the Sankey stays on Overview; locations, long-MC, a word
 * cloud, an hour-of-day histogram) is an opt-in flag on the spec rather than a fork of
 * this file, so the three pages cannot drift into three different layouts.
 *
 * This file composes `model/` functions; it computes nothing of its own that a test
 * elsewhere does not already own.
 */

import { useMemo, useState } from 'preact/hooks';
import { company, dateFrom, dateTo } from '../../app/state.js';
import { Card, Coverage, EmptyState } from '../../components/Card.jsx';
import { Tile, TileRow } from '../../components/Tile.jsx';
import { Segmented, SCOPE_OPTIONS } from '../../components/Segmented.jsx';
import { PageControls } from '../../components/PageControls.jsx';
import { SoldierSearch } from '../../components/SoldierSearch.jsx';
import { Leaderboard } from '../../components/Leaderboard.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../../format.js';
import { Bar, ChartCard, GroupedBar, Heatmap, Histogram, Line, WordCloud } from '../../charts/index.js';
import { COMPANIES, PLATOONS, UNASSIGNED } from '../../model/domain.js';
import { ALL_COMPANIES } from '../../model/scope.js';
import { toHolidays, holidaysIn, weekendBands } from '../../model/calendarMarks.js';
import { GRANULARITIES } from '../../model/buckets.js';
import { toRotations } from '../../model/rotations.js';
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
 * One trend card: a Battalion/Companies toggle over a Line chart. Used for both the
 * category's own duty-class trend and, where a page needs one, a second trend from a
 * different source (Report Sick's FormSG submissions, which `dutyTrend` cannot read).
 *
 * A real component, not a helper called as a plain function, specifically so its
 * `useState` for the scope toggle is safe — a second trend card built by calling a
 * function during another component's render would share no hook slot of its own.
 *
 * With a single company selected in the page bar the Battalion/Companies toggle has
 * nothing to switch between, so it is hidden and the chart draws that company's one line
 * in its own colour slot.
 * @param {{title: string, coverage: string, trendFn: function(string, string[]): !Object,
 *     dates: string[], weekends: Array<!Object>, holidays: Array<!Object>}} props The
 *     card's title and coverage line; `trendFn(scope, dates)` returns `{dates, series}`;
 *     the dates to plot and the weekend/holiday annotations to draw under them.
 * @returns {!preact.VNode} The card.
 */
function TrendSection({ title, coverage, trendFn, dates, weekends, holidays }) {
  const scopedCompany = company.value !== ALL_COMPANIES ? company.value : null;
  const [scope, setScope] = useState('battalion');
  const effectiveScope = scopedCompany ? 'battalion' : scope;
  const trend = trendFn(effectiveScope, dates);

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
          weekends={weekends}
          holidays={holidays}
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
 * The Company x Platoon heatmap of a duty class's rate.
 * @param {{episodes: Array<!Object>, dutyClass: string, cells?: Array<!Object>,
 *     title?: string, coverage?: string, valueName?: string}} props Episodes to count and
 *     the duty class to keep — unless `cells` is given, in which case they are drawn
 *     as-is (the page built them from another source, e.g. FormSG submissions) and
 *     `episodes`/`dutyClass` are ignored.
 * @returns {!preact.VNode} The card.
 */
function PlatoonHeatmap({
  episodes,
  dutyClass,
  cells,
  title = 'By Company and Platoon',
  coverage = 'Count of episodes; a bare platoon axis, not a rate — see the table for totals.',
  valueName = 'episodes',
  empty = 'No episodes in range to place on the grid.',
}) {
  const drawnCells = cells || episodesToCells_(episodes, dutyClass);

  return (
    <ChartCard title={title} coverage={coverage} empty={empty}>
      <Heatmap rows={COMPANIES} columns={PLATOONS} cells={drawnCells} valueName={valueName} />
    </ChartCard>
  );
}

/**
 * Counts episodes of one duty class per company x platoon for the heatmap grid.
 * @param {Array<!Object>} episodes Episodes from `buildEpisodes`.
 * @param {string} dutyClass Duty class to keep, from DUTY_CLASS.
 * @returns {Array<{row: string, column: string, value: number}>} Non-empty cells only.
 */
function episodesToCells_(episodes, dutyClass) {
  const scoped = episodes.filter((episode) => episode.dutyClass === dutyClass);
  const cells = [];
  COMPANIES.forEach((company) => {
    PLATOONS.forEach((platoon) => {
      const matching = scoped.filter((e) => e.company === company && (e.platoon || UNASSIGNED) === platoon);
      if (matching.length > 0) {
        cells.push({ row: company, column: platoon, value: matching.length });
      }
    });
  });
  return cells;
}

/**
 * The reasons-over-time grouped bar, with its own granularity radio.
 * @param {{items: Array<{date: string, labels: string[]}>, rotations: Array<!Object>}}
 *     props Dated, labelled rows, and the rotation schedule.
 * @returns {!preact.VNode} The card.
 */
function ReasonsOverTime({ items, rotations, title = 'Top Reasons Over Time' }) {
  const [granularity, setGranularity] = useState('daily');
  const trend = useMemo(
    () => topLabelsOverTime(items, granularity, rotations, 5),
    [items, granularity, rotations]
  );

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
 * @returns {!preact.VNode} The card.
 */
function LocationsCard({ personnel }) {
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
 * The long-term MC panel: count and roster of episodes exceeding 13 days.
 * @param {{episodes: Array<!Object>, from: string, to: string}} props Episodes, and the
 *     range to count active long-MC soldiers over.
 * @returns {!preact.VNode} The card.
 */
function LongMcCard({ episodes, from, to }) {
  const trend = longMcTrend(episodes, from, to, 'Att C', LONG_MC_MIN_DAYS);
  const roster = longMcRoster(episodes, 'Att C', LONG_MC_MIN_DAYS);
  const peak = trend.reduce((max, day) => Math.max(max, day.count), 0);

  return (
    <Card title={'Long-Term MC (≥' + (LONG_MC_MIN_DAYS + 1) + ' days)'} note={fmtInt(peak) + ' soldiers at the peak'}>
      {roster.length === 0 ? (
        <EmptyState>No MC in range runs longer than {LONG_MC_MIN_DAYS + 1} days.</EmptyState>
      ) : (
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Platoon</th>
                <th class="num">Days</th>
                <th>Start</th>
                <th>End</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((row) => (
                <tr key={row.key + row.startDate}>
                  <td>{row.name}</td>
                  <td>{row.company}</td>
                  <td>{row.platoon}</td>
                  <td class="num">{fmtInt(row.days)}</td>
                  <td>{fmtDate(row.startDate)}</td>
                  <td>{fmtDate(row.endDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * The company and platoon rate rankings, side by side.
 * @param {{personnel: Array<!Object>, strength: Array<!Object>, dutyClass: string}} props
 *     Inputs to `rankUnits`.
 * @returns {!preact.VNode} The card.
 */
function UnitRankings({ personnel, strength, dutyClass }) {
  const companies = rankUnits(personnel, strength, dutyClass, 'company');
  const platoons = rankUnits(personnel, strength, dutyClass, 'platoon');

  return (
    <div class="grid-2">
      <Card title="Companies, by Rate">
        {companies.length === 0 ? (
          <EmptyState>No data in range.</EmptyState>
        ) : (
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th class="num">Rate per 100</th>
                  <th class="num">Days</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((row) => (
                  <tr key={row.company}>
                    <td>{row.company}</td>
                    <td class="num">{fmtInt(row.per100)}</td>
                    <td class="num">{fmtInt(row.days)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="Platoons, by Rate">
        {platoons.length === 0 ? (
          <EmptyState>No data in range.</EmptyState>
        ) : (
          <div class="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Platoon</th>
                  <th class="num">Rate per 100</th>
                </tr>
              </thead>
              <tbody>
                {platoons.map((row) => (
                  <tr key={row.company + row.platoon}>
                    <td>{row.company}</td>
                    <td>{row.platoon}</td>
                    <td class="num">{fmtInt(row.per100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * A single soldier's events for this category, once picked from the search box.
 * @param {{personnel: Array<!Object>, episodes: Array<!Object>, dutyClass: string,
 *     soldierKey: ?string}} props The scoped data and the selected soldier's key.
 * @returns {!preact.VNode} The table, or nothing when no soldier is selected.
 */
function SoldierEvents({ episodes, dutyClass, soldierKey }) {
  if (!soldierKey) {
    return null;
  }
  const rows = episodes
    .filter((episode) => episode.key === soldierKey && episode.dutyClass === dutyClass)
    .sort((a, b) => toText(b.startDate).localeCompare(toText(a.startDate)));

  return (
    <Card title="This Soldier's History">
      {rows.length === 0 ? (
        <EmptyState>No episodes of this kind on record for this soldier.</EmptyState>
      ) : (
        <div class="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Start</th>
                <th>End</th>
                <th class="num">Days</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.key + index}>
                  <td>{fmtDate(row.startDate)}</td>
                  <td>{fmtDate(row.endDate)}</td>
                  <td class="num">{fmtInt(row.daysLost)}</td>
                  <td>{row.reasons.join('; ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/**
 * The shared category page.
 * @param {!Object} spec See the individual page files (`ReportSick.jsx`, `McMa.jsx`,
 *     `Status.jsx`) for the concrete spec each one passes.
 * @returns {!preact.VNode} The page.
 */
export function CategoryPage(spec) {
  const {
    title,
    dataset,
    calendarDates,
    dutyClass,
    leaderboardMetric,
    reasonSource,
    reasonsTitle,
    showHeatmap,
    heatmapBuilder,
    heatmapTitle,
    heatmapCoverage,
    heatmapValueName,
    heatmapEmpty,
    showLocations,
    showLongMc,
    showWordCloud,
    wordCloudBuilder,
    wordCloudTitle = 'Free-Text Reasons',
    showHistogram,
    histogramBuilder,
    soldierIndex,
    tileLabels = {},
    secondTileRow,
    trendTitle,
    showLeaderboard = true,
    showUnitRankings = true,
    extraTrend,
    afterLeaderboardBuilder,
  } = spec;

  // The selectable range and the trend x-axis come from the full, unscoped parade dates
  // (`calendarDates`, passed by each page) so they do not contract when a company that
  // filed on fewer days is picked in the page bar.
  const paradeDates = useMemo(
    () => calendarDates || datesPresent(dataset.strength),
    [calendarDates, dataset.strength]
  );
  const holidays = useMemo(() => toHolidays(dataset.holidays), [dataset.holidays]);
  const rotations = useMemo(() => toRotations(dataset.rotations), [dataset.rotations]);

  const effectiveFrom = dateFrom.value || paradeDates[0] || isoToday();
  const effectiveTo = dateTo.value || paradeDates[paradeDates.length - 1] || isoToday();
  const trendDates = useMemo(() => eachDay(effectiveFrom, effectiveTo), [effectiveFrom, effectiveTo]);
  const weekends = useMemo(() => weekendBands(effectiveFrom, effectiveTo), [effectiveFrom, effectiveTo]);
  const rangeHolidays = useMemo(
    () => holidaysIn(holidays, effectiveFrom, effectiveTo),
    [holidays, effectiveFrom, effectiveTo]
  );

  const rangedEpisodes = useMemo(
    () =>
      spec.episodes.filter(
        (episode) => episode.startDate && withinRange(episode.startDate, effectiveFrom, effectiveTo)
      ),
    [spec.episodes, effectiveFrom, effectiveTo]
  );

  const [soldierKey, setSoldierKey] = useState(null);

  // Reasons-over-time is filtered to the same range as every other panel on the page.
  // Built here, not by the caller, because the caller has no access to `effectiveFrom`/
  // `effectiveTo` — the range a page-level `reasonItems` was built from a full page ago
  // would otherwise silently outlive the range control.
  const reasonItems = useMemo(() => {
    if (!reasonSource) return null;
    return reasonSource.rows
      .filter((row) => withinRange(reasonSource.dateOf(row), effectiveFrom, effectiveTo))
      .map((row) => ({ date: reasonSource.dateOf(row), labels: reasonSource.labelsOf(row) }));
  }, [reasonSource, effectiveFrom, effectiveTo]);

  // Same reasoning as reasonItems above: built here, over the current range, rather than
  // handed in pre-built and silently stuck on whatever range was active when the page
  // first rendered.
  const wordCloudWords = useMemo(
    () => (wordCloudBuilder ? wordCloudBuilder(effectiveFrom, effectiveTo) : []),
    [wordCloudBuilder, effectiveFrom, effectiveTo]
  );
  const histogramBins = useMemo(
    () => (histogramBuilder ? histogramBuilder(effectiveFrom, effectiveTo) : []),
    [histogramBuilder, effectiveFrom, effectiveTo]
  );
  // A page that supplies `heatmapBuilder` draws the grid from its own source (Report
  // Sick's FormSG submissions) rather than the parade-state episodes; built here so it
  // tracks the range control like every other panel.
  const heatmapCells = useMemo(
    () => (heatmapBuilder ? heatmapBuilder(effectiveFrom, effectiveTo) : null),
    [heatmapBuilder, effectiveFrom, effectiveTo]
  );

  const counts = episodeCounts(rangedEpisodes, dutyClass);

  const leaderboard =
    leaderboardMetric === 'days'
      ? topByDays(rangedEpisodes, dutyClass, 10)
      : leaderboardMetric === 'status'
        ? topByStatusCount(rangedEpisodes, 10)
        : topByCount(rangedEpisodes, dutyClass, 10);

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">{title}</h1>
          <p class="pagehead__sub">{fmtDate(effectiveFrom)} – {fmtDate(effectiveTo)}</p>
        </div>
      </header>

      <PageControls min={paradeDates[0] || isoToday()} max={paradeDates[paradeDates.length - 1] || isoToday()} />

      <TileRow>
        <Tile label={tileLabels.episodes || 'Episodes'} value={fmtInt(counts.total.episodes)} />
        <Tile label={tileLabels.soldiers || 'Soldiers'} value={fmtInt(counts.total.soldiers)} />
        <Tile label={tileLabels.perSoldier || 'Episodes per soldier'} value={counts.total.perSoldier === null ? '—' : counts.total.perSoldier.toFixed(1)} />
      </TileRow>

      {secondTileRow ? <TileRow>{secondTileRow(effectiveFrom, effectiveTo)}</TileRow> : null}

      <TrendSection
        title={trendTitle || title + ' Trend'}
        coverage="Rate per 100 accountable; a company not filing that day is a gap."
        trendFn={(scope, dates) => dutyTrend(dataset.personnel, dataset.strength, dutyClass, dates, { scope, session: 'FPS' })}
        dates={trendDates}
        weekends={weekends}
        holidays={rangeHolidays}
      />

      {extraTrend ? (
        <TrendSection
          title={extraTrend.title}
          coverage={extraTrend.coverage}
          trendFn={extraTrend.trendFn}
          dates={trendDates}
          weekends={weekends}
          holidays={rangeHolidays}
        />
      ) : null}

      {showHeatmap ? (
        <PlatoonHeatmap
          episodes={rangedEpisodes}
          dutyClass={dutyClass}
          cells={heatmapCells}
          title={heatmapTitle}
          coverage={heatmapCoverage}
          valueName={heatmapValueName}
          empty={heatmapEmpty}
        />
      ) : null}

      {reasonItems ? (
        <ReasonsOverTime items={reasonItems} rotations={rotations} title={reasonsTitle} />
      ) : null}

      {showWordCloud ? (
        <ChartCard title={wordCloudTitle} empty="No free-text reasons recorded in range.">
          <WordCloud words={wordCloudWords || []} />
        </ChartCard>
      ) : null}

      {showHistogram ? (
        <ChartCard title="Time of Day" empty="No timestamped submissions in range.">
          <Histogram bins={histogramBins || []} />
        </ChartCard>
      ) : null}

      {showLocations ? <LocationsCard personnel={dataset.personnel} /> : null}

      {showLongMc ? <LongMcCard episodes={spec.episodes} from={effectiveFrom} to={effectiveTo} /> : null}

      {showLeaderboard ? (
        <Card title={'Top 10 by ' + (leaderboardMetric === 'days' ? 'Days Lost' : leaderboardMetric === 'status' ? 'Statuses Held' : 'Episode Count')}>
          <Leaderboard rows={leaderboard} metric={leaderboardMetric === 'status' ? 'status' : leaderboardMetric === 'days' ? 'days' : 'count'} />
        </Card>
      ) : null}

      {showUnitRankings ? (
        <UnitRankings personnel={dataset.personnel} strength={dataset.strength} dutyClass={dutyClass} />
      ) : null}

      {afterLeaderboardBuilder ? afterLeaderboardBuilder(effectiveFrom, effectiveTo) : null}

      <Card title="Soldier Search">
        <SoldierSearch index={soldierIndex} onSelect={(soldier) => setSoldierKey(soldier.key)} />
      </Card>
      <SoldierEvents episodes={spec.episodes} dutyClass={dutyClass} soldierKey={soldierKey} />
    </div>
  );
}
