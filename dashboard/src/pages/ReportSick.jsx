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
import { submissionRateByCompany, submissionTrend, toSubmissions, topSubmitters } from '../model/formsg.js';
import { datesPresent } from '../model/metrics.js';
import { scopeDataset, scopeSubmissions } from '../model/scope.js';
import { soldierIndex } from '../model/soldier.js';
import { clinicalBucketOf, reasonKeywords } from '../model/symptoms.js';
import { isWeekend } from '../model/dates.js';
import { withinRange } from '../model/dateRange.js';
import { toTimeOfDay } from '../model/values.js';
import { CategoryPage } from './shared/CategoryPage.jsx';

/**
 * The FormSG-side leaderboard and company ranking: who, and which company, reports sick
 * most through the form, as distinct from the parade-state leaderboard above it.
 * @param {{submissions: Array<!Object>, strength: Array<!Object>, from: string,
 *     to: string}} props FormSG submissions and Strength Data, unfiltered, plus the
 *     range to restrict them to.
 * @returns {!preact.VNode} The two cards.
 */
function ReportedSickRankings({ submissions, strength, from, to }) {
  const ranged = submissions.filter((s) => withinRange(s.date, from, to));
  const strengthRanged = strength.filter((row) => withinRange(row.date, from, to));
  const top = topSubmitters(ranged, 10);
  const companies = submissionRateByCompany(ranged, strengthRanged);

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
      <Card title="Companies, by Reported-Sick Rate">
        <DataTable
          columns={[
            { key: 'company', label: 'Company' },
            { key: 'per100', label: 'Rate per 100', numeric: true },
            { key: 'count', label: 'Count', numeric: true },
          ]}
          rows={companies.map((row) => ({
            company: row.company,
            per100: row.per100 === null ? '—' : fmtInt(row.per100),
            count: fmtInt(row.count),
          }))}
          rowKey={(row) => row.company}
        />
        <Coverage>
          Company only. FormSG's "Unit &amp; Coy" answer names no platoon, so a
          platoon-level reported-sick ranking is not data this dashboard has.
        </Coverage>
      </Card>
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
  const wordCloudBuilder = (from, to) =>
    reasonKeywords(submissions.filter((s) => withinRange(s.date, from, to)), 60);
  const histogramBuilder = (from, to) =>
    hourBins(submissions.filter((s) => withinRange(s.date, from, to)));

  // Requirement 3.1/3.2: the FormSG side gets its own tile and trend, not only the
  // parade-state "reporting sick" CategoryPage already draws — the two are independent
  // sources of the same event and a reader comparing them needs both on screen at once.
  const extraTiles = (from, to) => (
    <Tile
      label="Reported sick (FormSG)"
      value={fmtInt(submissions.filter((s) => withinRange(s.date, from, to)).length)}
    />
  );
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
      extraTiles={extraTiles}
      extraTrend={extraTrend}
      showHeatmap
      showWordCloud
      wordCloudBuilder={wordCloudBuilder}
      showHistogram
      histogramBuilder={histogramBuilder}
      soldierIndex={index}
      afterLeaderboardBuilder={(from, to) => (
        <ReportedSickRankings submissions={submissions} strength={data.strength} from={from} to={to} />
      )}
    />
  );
}
