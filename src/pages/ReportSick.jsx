/**
 * Report sick: the parade-state and FormSG picture of who is reporting sick.
 *
 * The sections shared with MC/MA and Status come from `shared/category.jsx`; this file
 * adds what is unique to report sick — the FormSG side of every panel, the free-text
 * word cloud, and the hour-of-day histogram, none of which the other two categories have
 * a source for.
 */

import { useState } from 'preact/hooks';
import { Card } from '../components/Card.jsx';
import { Segmented } from '../components/Segmented.jsx';
import { DataTable } from '../components/Table.jsx';
import { Tile, TileRow } from '../components/Tile.jsx';
import { ChartCard, Histogram, WordCloud } from '../charts/index.js';
import { fmtInt } from '../format.js';
import { DUTY_CLASS } from '../model/classify.js';
import {
  REPORT_SICK_TYPES,
  reportSickTypeOf,
  submissionCounts,
  submissionTrend,
  topSubmitters,
} from '../model/formsg.js';
import { episodeCounts } from '../model/metrics.js';
import { clinicalBucketOf, reasonKeywords } from '../model/symptoms.js';
import { isWeekend } from '../model/dates.js';
import { withinRange } from '../model/dateRange.js';
import { toTimeOfDay } from '../model/values.js';
import {
  CategoryPage,
  DutyTrend,
  EpisodeTiles,
  PlatoonHeatmap,
  ReasonsOverTime,
  SoldierLookup,
  TrendSection,
  UnitRankings,
  episodeCells,
  useCategory,
} from './shared/category.jsx';

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

/** @type {string[]} Hour labels, 00:00 through 23:00. */
const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, '0') + ':00');

/**
 * Buckets FormSG submissions into hour-of-day bins, split by weekday/weekend.
 * @param {Array<!Object>} submissions Normalised FormSG submissions, already restricted
 *     to the range being drawn.
 * @returns {Array<{label: string, count: number, weekday: number, weekend: number}>} 24
 *     bins, midnight through 23:00, empty hours included.
 */
function hourBins(submissions) {
  const counts = HOUR_LABELS.map(() => ({ weekday: 0, weekend: 0 }));
  submissions.forEach((submission) => {
    const at = toTimeOfDay(submission.timestamp);
    if (!at || !submission.date) return;
    const bucket = counts[at.hour];
    if (isWeekend(submission.date)) {
      bucket.weekend += 1;
    } else {
      bucket.weekday += 1;
    }
  });
  return HOUR_LABELS.map((label, hour) => ({
    label,
    count: counts[hour].weekday + counts[hour].weekend,
    weekday: counts[hour].weekday,
    weekend: counts[hour].weekend,
  }));
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
      <ChartCard title="Top Self-Reported Report Sick Reasons" empty="No free-text reasons recorded in range.">
        <WordCloud words={reasonKeywords(ranged, 60)} />
      </ChartCard>
      <ChartCard title="Time of Day" empty="No timestamped submissions in range.">
        <Histogram bins={hourBins(ranged)} />
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
