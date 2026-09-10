/**
 * Report sick: the parade-state and FormSG picture of who is reporting sick.
 *
 * Everything shared with MC/MA and Status lives in `CategoryPage`; this file supplies
 * only what is unique to report sick — the FormSG clinical-bucket trend, the free-text
 * word cloud, and the hour-of-day histogram, none of which the other two categories have
 * a source for.
 */

import { useMemo } from 'preact/hooks';
import { company, dataset } from '../app/state.js';
import { Card, Coverage } from '../components/Card.jsx';
import { DataTable } from '../components/Table.jsx';
import { Tile } from '../components/Tile.jsx';
import { fmtInt } from '../format.js';
import { DUTY_CLASS } from '../model/classify.js';
import { buildEpisodes } from '../model/episodes.js';
import {
  submissionCounts,
  submissionHeatmapCells,
  submissionRateByCompany,
  submissionRateByPlatoon,
  submissionTrend,
  toSubmissions,
  topSubmitters,
} from '../model/formsg.js';
import { datesPresent, episodeCounts } from '../model/metrics.js';
import { scopeDataset, scopeSubmissions } from '../model/scope.js';
import { soldierIndex } from '../model/soldier.js';
import { clinicalBucketOf, reasonKeywords } from '../model/symptoms.js';
import { isWeekend } from '../model/dates.js';
import { withinRange } from '../model/dateRange.js';
import { toTimeOfDay } from '../model/values.js';
import { CategoryPage } from './shared/CategoryPage.jsx';

/**
 * Formats a rate-per-100 cell, keeping the em dash the rate functions use for "no
 * strength on record".
 * @param {?number} per100 The rate, or null.
 * @returns {string} The cell text.
 */
function fmtRate_(per100) {
  return per100 === null ? '—' : fmtInt(per100);
}

/**
 * The FormSG-side rankings: who reports sick most through the form, and how the reported-
 * sick rate falls across companies and platoons. These replace the parade-state
 * "Top 10 by Episode Count" and "Companies/Platoons, by Rate" — on this page the form is
 * the primary source, and the parade-state versions sit one section up as tiles and a
 * trend instead.
 *
 * Platoon is not something FormSG states; it is inferred from the submitter's 4D through
 * the same rule `model/platoon.js` applies elsewhere, and a submission with no usable 4D
 * is placed under HQ. The coverage note on the platoon table says so.
 * @param {{submissions: Array<!Object>, strength: Array<!Object>, from: string,
 *     to: string}} props FormSG submissions and Strength Data, unfiltered, plus the
 *     range to restrict them to.
 * @returns {!preact.VNode} The three cards.
 */
function ReportedSickRankings({ submissions, strength, from, to }) {
  const ranged = submissions.filter((s) => withinRange(s.date, from, to));
  const strengthRanged = strength.filter((row) => withinRange(row.date, from, to));
  const top = topSubmitters(ranged, 10);
  const companies = submissionRateByCompany(ranged, strengthRanged);
  const platoons = submissionRateByPlatoon(ranged, strengthRanged);

  return (
    <>
      <Card title="Top 10 by Reported Sick (FormSG)">
        <DataTable
          columns={[
            { key: 'rank', label: '#', numeric: true },
            { key: 'name', label: 'Name' },
            { key: 'fourD', label: '4D' },
            { key: 'company', label: 'Company' },
            { key: 'count', label: 'Count', numeric: true },
          ]}
          rows={top.map((row, index) => ({ ...row, rank: index + 1, count: fmtInt(row.count) }))}
          rowKey={(row) => row.key}
        />
      </Card>
      <div class="grid-2">
        <Card title="Companies, by Rate">
          <DataTable
            columns={[
              { key: 'company', label: 'Company' },
              { key: 'per100', label: 'Reported Sick %', numeric: true, sortable: true, sortValue: (r) => r.per100Raw },
              { key: 'count', label: 'Reported Sick Count', numeric: true, sortable: true, sortValue: (r) => r.countRaw },
            ]}
            rows={companies.map((row) => ({
              company: row.company,
              per100: fmtRate_(row.per100),
              per100Raw: row.per100,
              count: fmtInt(row.count),
              countRaw: row.count,
            }))}
            rowKey={(row) => row.company}
          />
        </Card>
        <Card title="Platoons, by Rate">
          <DataTable
            columns={[
              { key: 'company', label: 'Company' },
              { key: 'platoon', label: 'Platoon' },
              { key: 'per100', label: 'Reported Sick %', numeric: true, sortable: true, sortValue: (r) => r.per100Raw },
              { key: 'count', label: 'Reported Sick Count', numeric: true, sortable: true, sortValue: (r) => r.countRaw },
            ]}
            rows={platoons.map((row) => ({
              company: row.company,
              platoon: row.platoon,
              per100: fmtRate_(row.per100),
              per100Raw: row.per100,
              count: fmtInt(row.count),
              countRaw: row.count,
            }))}
            rowKey={(row) => row.company + ' ' + row.platoon}
          />
          <Coverage>
            Platoon is inferred from the submitter's 4D; a submission with no 4D is placed
            under HQ. The rate divides by the same platoon strength the parade-state
            rankings use.
          </Coverage>
        </Card>
      </div>
    </>
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
 * @returns {!preact.VNode} The page.
 */
export function ReportSick() {
  const full = dataset.value;
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const calendarDates = useMemo(() => datesPresent(full.strength), [full.strength]);
  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const submissions = useMemo(
    () => scopeSubmissions(toSubmissions(data.formSg), company.value),
    [data.formSg, company.value]
  );
  const index = useMemo(() => soldierIndex(data.personnel, submissions), [data.personnel, submissions]);

  const reasonSource = useMemo(
    () => ({ rows: submissions, dateOf: (s) => s.date, labelsOf: (s) => [clinicalBucketOf(s.symptomAnswer)] }),
    [submissions]
  );
  const rangedSubmissions = (from, to) => submissions.filter((s) => withinRange(s.date, from, to));

  const wordCloudBuilder = (from, to) => reasonKeywords(rangedSubmissions(from, to), 60);
  const histogramBuilder = (from, to) => hourBins(rangedSubmissions(from, to));
  const heatmapBuilder = (from, to) => submissionHeatmapCells(rangedSubmissions(from, to));

  // The top row carries both sources of the same event side by side: three parade-state
  // "Reporting Sick" tiles from CategoryPage, then these four FormSG "Reported Sick" ones,
  // ending with the absolute gap between the two counts. A reader comparing the channels
  // needs the pair on screen at once.
  const secondTileRow = (from, to) => {
    const ranged = rangedSubmissions(from, to);
    const formSg = submissionCounts(ranged).total;
    const paradeEpisodes = episodeCounts(
      episodes.filter((e) => e.startDate && withinRange(e.startDate, from, to)),
      DUTY_CLASS.REPORT_SICK
    ).total.episodes;
    return (
      <>
        <Tile label="Reported Sick (FormSG)" value={fmtInt(formSg.submissions)} />
        <Tile label="Soldiers Reported Sick" value={fmtInt(formSg.soldiers)} />
        <Tile
          label="Mean Reported Sick Count per Soldier"
          value={formSg.perSoldier === null ? '—' : formSg.perSoldier.toFixed(1)}
        />
        <Tile label="Δ Report Sick" value={fmtInt(Math.abs(paradeEpisodes - formSg.submissions))} />
      </>
    );
  };
  const extraTrend = {
    title: 'Reported Sick (FormSG) Trend',
    coverage: 'FormSG submissions; a company with no submissions in range is drawn flat at zero, not a gap.',
    trendFn: (scope, dates) => submissionTrend(submissions, data.strength, dates, { scope, session: 'FPS' }),
  };

  return (
    <CategoryPage
      title="Report Sick"
      dataset={data}
      calendarDates={calendarDates}
      episodes={episodes}
      dutyClass={DUTY_CLASS.REPORT_SICK}
      leaderboardMetric="count"
      reasonSource={reasonSource}
      reasonsTitle="Top Report Sick Categories over time"
      tileLabels={{
        episodes: 'Reporting Sick (Parade State) Count',
        soldiers: 'Soldiers Reporting Sick',
        perSoldier: 'Mean Reporting Sick Count per Soldier',
      }}
      secondTileRow={secondTileRow}
      trendTitle="Reporting Sick (Parade State) Trend"
      extraTrend={extraTrend}
      showHeatmap
      heatmapBuilder={heatmapBuilder}
      heatmapTitle="Reported Sick (FormSG) — by Company and Platoon"
      heatmapCoverage="Count of FormSG submissions. Platoon is inferred from the 4D; a submission with no 4D is placed under HQ."
      heatmapValueName="submissions"
      heatmapEmpty="No FormSG submissions in range to place on the grid."
      showWordCloud
      wordCloudTitle="Top Self-Reported Report Sick Reasons"
      wordCloudBuilder={wordCloudBuilder}
      showHistogram
      histogramBuilder={histogramBuilder}
      showLeaderboard={false}
      showUnitRankings={false}
      soldierIndex={index}
      afterLeaderboardBuilder={(from, to) => (
        <ReportedSickRankings submissions={submissions} strength={data.strength} from={from} to={to} />
      )}
    />
  );
}
