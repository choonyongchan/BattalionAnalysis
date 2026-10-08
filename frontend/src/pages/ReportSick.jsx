/**
 * Report sick: the parade-state and FormSG picture of who is reporting sick.
 *
 * The sections shared with MC/MA and Status come from `shared/` (category, trends, grids,
 * rankings); this file
 * adds what is unique to report sick: the FormSG side of every panel, the type split, the
 * free-text reasons, and when soldiers file, none of which the other two categories have a
 * source for.
 */

import { useState } from 'preact/hooks';
import { Card } from '../components/Card.jsx';
import { Segmented } from '../components/Segmented.jsx';
import { DataTable } from '../components/Table.jsx';
import { Tile, TileRow } from '../components/Tile.jsx';
import { Bar, ChartCard, Donut, Heatmap } from '../charts/index.js';
import { fmtInt } from '../format.js';
import { DUTY_CLASS } from '../model/classify.js';
import {
  REPORT_SICK_TYPES,
  hourByWeekday,
  reportSickTypeOf,
  typeShares,
  submissionCounts,
  submissionTrend,
  topSubmitters,
} from '../model/formsg.js';
import { episodeCounts } from '../model/metrics.js';
import { CLUSTER_CASES, CLUSTER_DAYS, clinicalBucketOf, infectiousByPlatoon, reasonKeywords } from '../model/symptoms.js';
import { platoonOf } from '../model/platoon.js';
import { WEEKDAY_NAMES } from '../../../shared/dates.js';
import { withinRange } from '../model/dateRange.js';
import { CategoryPage, EpisodeTiles, useCategory } from './shared/category.jsx';
import { DutyTrend, TrendSection } from './shared/trends.jsx';
import { PlatoonHeatmap, ReasonsOverTime, episodeCells } from './shared/grids.jsx';
import { SoldierLookup, UnitRankings } from './shared/rankings.jsx';

/** @type {string} The duty class this page is about. */
const DUTY = DUTY_CLASS.REPORT_SICK;

/**
 * The FormSG leaderboard: who reports sick most through the form.
 * @param {{submissions: Array<!Object>}} props FormSG submissions already restricted to the range.
 * @returns {!preact.VNode} The card.
 */
function ReportedSickTop({ submissions }) {
  const top = topSubmitters(submissions, 10);
  return (
    <Card title="Top 10 by Reported Sick (FormSG)">
      <DataTable
        columns={[
          { key: 'rank', label: '#', numeric: true },
          { key: 'name', label: 'Name' },
          { key: 'company', label: 'Company' },
          { key: 'count', label: 'Count', numeric: true },
        ]}
        rows={top.map((row, index) => ({ ...row, rank: index + 1, count: fmtInt(row.count) }))}
        rowKey={(row) => row.key}
      />
    </Card>
  );
}

/**
 * The words soldiers use most in the form's free-text reason, as a ranked bar.
 *
 * A bar rather than the word cloud it replaces: a cloud's font size cannot be read as a
 * number, and its layout puts the eye on long words rather than frequent ones.
 * @param {{submissions: Array<!Object>}} props FormSG submissions already restricted to the range.
 * @returns {!preact.VNode} The card.
 */
function ReasonWords({ submissions }) {
  const words = reasonKeywords(submissions, 12);
  return (
    <ChartCard
      title="Words in Self-Reported Reasons"
      coverage="The 12 commonest words in the free-text reason, after common words are dropped."
      empty="No free-text reasons recorded in range."
    >
      <Bar categories={words.map((w) => w.word)} values={words.map((w) => w.count)} valueName="submissions" />
    </ChartCard>
  );
}

/** @type {string} The type filter's "no filter" option. */
const ALL_TYPES = 'ALL';

/** @type {Array<{name: string, label: string}>} The type filter's options, "All" first. */
const TYPE_OPTIONS = [{ name: ALL_TYPES, label: 'All' }, ...REPORT_SICK_TYPES];

/**
 * The FormSG trend, with a filter for the form's report-sick type.
 *
 * A component of its own so the filter's `useState` has its own hook slot. The filter
 * narrows only this chart; the tiles, heatmap and rankings still count every submission.
 * @param {{submissions: Array<!Object>, strength: Array<!Object>, range: !Object}} props
 *     Every FormSG submission in scope, Strength Data, and the range.
 * @returns {!preact.VNode} The trend card.
 */
function FormSgTrend({ submissions, strength, range }) {
  const [type, setType] = useState(ALL_TYPES);
  const shown =
    type === ALL_TYPES ? submissions : submissions.filter((s) => reportSickTypeOf(s) === type);

  return (
    <TrendSection
      title="Reported Sick (FormSG) Trend"
      coverage="FormSG submissions; a company with no submissions in range is drawn flat at zero, not a gap."
      trendFn={(scope, dates) => submissionTrend(shown, strength, dates, { scope, session: 'FPS' })}
      range={range}
      controls={
        <Segmented options={TYPE_OPTIONS} value={type} onChange={setType} label="Report sick type" />
      }
    />
  );
}

/** @type {string[]} The punch card's columns, midnight to 23:00. */
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0'));

/** @type {number} Days the outbreak watch looks back from the end of the range. */
const WATCH_DAYS = 14;

/**
 * Infectious-sounding cases per platoon over the last two weeks of the range, with any
 * platoon where they cluster named above the grid: an early warning for the MO.
 * @param {{episodes: Array<!Object>, to: string}} props All episodes, and the range's end.
 * @returns {!preact.VNode} The card.
 */
function OutbreakCard({ episodes, to }) {
  const platoon = (episode) =>
    platoonOf({ company: episode.company, platoon: episode.platoon, four_d: episode.fourD }).platoon;
  const watch = infectiousByPlatoon(episodes, to, WATCH_DAYS, platoon);
  const note =
    watch.clusters.length > 0
      ? 'Cluster: ' + watch.clusters.join(', ') + ' (' + CLUSTER_CASES + ' or more new cases within ' + CLUSTER_DAYS + ' days).'
      : 'No platoon has ' + CLUSTER_CASES + ' new cases within ' + CLUSTER_DAYS + ' days.';
  return (
    <ChartCard
      title="Outbreak Watch"
      note={note}
      coverage="New report-sick, MC, MA or Status lines whose reason names fever, flu, cough, cold, a stomach bug or conjunctivitis, by the platoon sub-header. A line that says only MC is not counted."
      empty="No infectious-sounding case in the last two weeks of the range."
    >
      <Heatmap
        rows={watch.rows}
        columns={watch.days}
        cells={watch.cells}
        rowName="Platoon"
        valueName="new cases"
        detail={(cell) => cell.names}
        showValues
        height={Math.max(160, watch.rows.length * 32 + 60)}
      />
    </ChartCard>
  );
}

/**
 * The Report Sick page.
 *
 * Every panel carries both sources of the same event: the parade state ("Reporting
 * Sick") and FormSG ("Reported Sick"). Each source's tiles count soldiers rather than
 * events, and the second tile row ends with the absolute gap between the two event counts,
 * because a reader comparing the channels needs that gap on screen.
 * @returns {!preact.VNode} The page.
 */
export function ReportSick() {
  const { data, episodes, submissions, index, range } = useCategory();
  const ranged = submissions.filter((s) => withinRange(s.date, range.from, range.to));
  const formSg = submissionCounts(ranged).total;
  const paradeEpisodes = episodeCounts(range.episodes, DUTY).total.episodes;

  return (
    <CategoryPage title="Report Sick" range={range}>
      <EpisodeTiles
        range={range}
        dutyClass={DUTY}
        labels={{
          episodes: null,
          soldiers: 'Soldiers Reporting Sick',
          perSoldier: 'Mean Reporting Sick Count per Soldier',
        }}
      />
      <TileRow>
        <Tile label="Soldiers Reported Sick" value={fmtInt(formSg.soldiers)} />
        <Tile
          label="Mean Reported Sick Count per Soldier"
          value={formSg.perSoldier === null ? '—' : formSg.perSoldier.toFixed(1)}
        />
        <Tile label="Δ Report Sick" value={fmtInt(Math.abs(paradeEpisodes - formSg.submissions))} />
      </TileRow>
      <OutbreakCard episodes={episodes} to={range.to} />
      <DutyTrend title="Reporting Sick (Parade State) Trend" data={data} dutyClass={DUTY} range={range} />
      <FormSgTrend submissions={submissions} strength={data.strength} range={range} />
      <PlatoonHeatmap
        cells={episodeCells(range.episodes, DUTY)}
        title="Reporting Sick (Parade State) — by Company and Platoon"
      />
      <ReasonsOverTime
        title="Top Report Sick Categories over time"
        rows={submissions}
        dateOf={(s) => s.date}
        labelsOf={(s) => [clinicalBucketOf(s.symptomAnswer)]}
        range={range}
      />
      <div class="grid-2">
        <ChartCard
          title="Report Sick Type (FormSG)"
          coverage="Share of FormSG submissions in range by the type the soldier picked."
          empty="No FormSG submissions in range."
        >
          <Donut slices={typeShares(ranged)} valueName="submissions" />
        </ChartCard>
        <ReasonWords submissions={ranged} />
      </div>
      <ChartCard
        title="When Soldiers Report Sick"
        coverage="FormSG submissions by weekday and hour of submission, Singapore time."
        empty="No timestamped submissions in range."
      >
        <Heatmap rows={WEEKDAY_NAMES} columns={HOURS} cells={hourByWeekday(ranged)} valueName="submissions" showValues height={320} />
      </ChartCard>
      <ReportedSickTop submissions={ranged} />
      <UnitRankings
        range={range}
        dutyClass={DUTY}
        labels={{ count: 'Number of Report Sick', soldiers: 'Unique Personnel Reporting Sick' }}
      />
      <SoldierLookup index={index} episodes={episodes} dutyClass={DUTY} />
    </CategoryPage>
  );
}
