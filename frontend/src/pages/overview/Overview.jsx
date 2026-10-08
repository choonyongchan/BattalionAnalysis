/**
 * Battalion overview: who has filed this morning, today's numbers, and how the battalion
 * is trending.
 *
 * Two clocks run on this page and they answer different questions. `selectedDate` names
 * one parade — the filing chips, the tile row and the absence ring describe that single day
 * and ignore the range entirely, because "today's strength" should never sit under a span a
 * reader has to remember is active. `dateFrom`/`dateTo` bound every trend and the Sankey;
 * null on both means "all data". `company` narrows every panel on the page to one company,
 * or `ALL` for the whole battalion — applied once, upstream, by `scopeDataset`.
 *
 * The selected parade also anchors the one forward-looking section: presence by rank tier,
 * then the list of who is due back when, from the dates each absence states
 * (`model/projection.js`), and who has just come off MC or Light Duty (`model/recentReturns.js`).
 */

import { useEffect, useMemo, useRef } from 'preact/hooks';
import { company, dataset, dateFrom, dateTo, selectedDate } from '../../app/state.js';
import { Card, Coverage, EmptyState } from '../../components/Card.jsx';
import { Tile, TileRow } from '../../components/Tile.jsx';
import { PageControls } from '../../components/PageControls.jsx';
import { FilingChips } from '../../components/FilingChips.jsx';
import { fmtDate, fmtFraction, fmtInt, fmtPercent } from '../../format.js';
import { ChartCard, Donut, Line } from '../../charts/index.js';
import { COMPANIES } from '../../../../shared/domain.js';
import { DUTY_CLASS, MC_MA } from '../../model/classify.js';
import { ALL_COMPANIES, scopeDataset, scopeFilings, scopeSubmissions } from '../../model/scope.js';
import { toHolidays, holidaysIn, weekendBands } from '../../model/calendarMarks.js';
import { absenceParts, datesPresent, battalionStrength, dutyCountsOn, distinctDutyOn } from '../../model/metrics.js';
import { eachDay } from '../../model/dateRange.js';
import { buildEpisodes } from '../../model/episodes.js';
import { toSubmissions, submissionTrend } from '../../model/formsg.js';
import { filingsOn, toFilings } from '../../model/submissions.js';
import { dutyTrend, presentTrend } from '../../model/strength.js';
import { DEFAULT_PROJECTION_DAYS } from '../../model/projection.js';
import { TrendSection } from '../shared/trends.jsx';
import { RecentReturnsCard, ReturnsCard, SankeyCard, TierCard } from './cards.jsx';

/** @type {string} Session every "today" figure and trend describes. */
const SESSION = 'FPS';

/**
 * Report sick from both sources on one chart: the parade state's count and FormSG's.
 *
 * They measure the same event recorded by different people, so the useful reading is the
 * gap between them, which two separate cards hid. Always the battalion (or the one company
 * picked in the page bar); the per-company view lives on the Report Sick page.
 * @param {{data: !Object, submissions: Array<!Object>, range: !Object}} props The scoped
 *     dataset, its FormSG submissions, and the trend range.
 * @returns {!preact.VNode} The card.
 */
function SickSourcesCard({ data, submissions, range }) {
  const options = { scope: 'battalion', session: SESSION, asRate: false };
  const parade = dutyTrend(data.personnel, data.strength, DUTY_CLASS.REPORT_SICK, range.days, options);
  const formsg = submissionTrend(submissions, data.strength, range.days, options);
  return (
    <ChartCard
      title="Reporting Sick: Parade State and FormSG"
      coverage="Parade state counts soldiers listed as reporting sick; FormSG counts submissions. A day with no filing reads zero."
    >
      <Line
        categories={range.days}
        series={[
          { name: 'Parade state', values: parade.series[0]?.values || [], neutral: true },
          { name: 'FormSG', values: formsg.series[0]?.values || [], accent: true },
        ]}
        weekends={range.weekends}
        holidays={range.holidays}
        valueName="soldiers"
      />
    </ChartCard>
  );
}

/**
 * The Overview page.
 * @returns {!preact.VNode} The page.
 */
export function Overview() {
  const full = dataset.value;
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const scopedCompany = company.value !== ALL_COMPANIES ? company.value : null;

  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const submissions = useMemo(
    () => scopeSubmissions(toSubmissions(data.formSg), company.value),
    [data.formSg, company.value]
  );
  const filings = useMemo(() => toFilings(data.submissions), [data.submissions]);
  const holidays = useMemo(() => toHolidays(data.holidays), [data.holidays]);
  // The selectable dates and the trend axis come from the full, unscoped strength so they
  // do not shrink when a company that filed on fewer days is picked.
  const paradeDates = useMemo(() => datesPresent(full.strength), [full.strength]);

  // Follow the newest parade: on first open, and when a background refresh brings a new
  // day while the viewer was looking at the latest one. A date picked by hand stays put.
  const latestSeen = useRef(null);
  useEffect(() => {
    const latest = paradeDates[paradeDates.length - 1] || null;
    if (!selectedDate.value || selectedDate.value === latestSeen.current) {
      selectedDate.value = latest;
    }
    latestSeen.current = latest;
  }, [paradeDates]);

  const today = selectedDate.value || paradeDates[paradeDates.length - 1] || null;
  const from = dateFrom.value || paradeDates[0] || today;
  const to = dateTo.value || paradeDates[paradeDates.length - 1] || today;
  const range = useMemo(
    () => ({ days: eachDay(from, to), weekends: weekendBands(from, to), holidays: holidaysIn(holidays, from, to) }),
    [from, to, holidays]
  );

  if (!today) {
    return (
      <div class="page">
        <header class="pagehead">
          <h1 class="pagehead__title">Battalion Overview</h1>
        </header>
        <EmptyState>No parade state has been read yet.</EmptyState>
      </div>
    );
  }

  const strength = battalionStrength(data.strength, today, SESSION);
  const hasParadeState = strength.companiesReporting.length > 0;
  const duty = hasParadeState ? dutyCountsOn(data.personnel, today, SESSION) : null;
  const reportedSickToday = submissions.filter((submission) => submission.date === today).length;
  const filingEntries = scopeFilings(filingsOn(filings, today, SESSION), company.value);

  const coverageLine = scopedCompany
    ? scopedCompany + ' only: parade state for ' + fmtDate(today) + (hasParadeState ? ' filed.' : ' not filed.')
    : 'Accurate to the parade states filed for ' +
      fmtDate(today) +
      ', ' +
      fmtFraction(strength.companiesReporting.length, COMPANIES.length) +
      ' companies.';
  const trendCoverage = 'Count of soldiers on each parade; a day with no parade state reads zero.';
  const dutyTrendFn = (dutyClass) => (scope, days) =>
    dutyTrend(data.personnel, data.strength, dutyClass, days, { scope, session: SESSION, asRate: false });

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Battalion Overview</h1>
          <p class="pagehead__sub">{fmtDate(today)}</p>
        </div>
      </header>

      <PageControls min={paradeDates[0] || today} max={paradeDates[paradeDates.length - 1] || today} />

      <Card
        title="Today's First Parade State"
        note="Lit in the company's colour once its first parade state reaches the database; the time is when it was received"
      >
        <FilingChips entries={filingEntries} />
      </Card>

      <TileRow>
        <Tile label="Total soldiers" value={fmtInt(strength.accountable)} />
        <Tile label="Present soldiers" value={fmtInt(hasParadeState ? strength.present : 0)} />
        <Tile label="% present" value={fmtPercent(strength.percentPresent / 100)} />
        <Tile label="Reporting sick" value={fmtInt(duty ? duty.counts[DUTY_CLASS.REPORT_SICK] || 0 : 0)} foot="Parade state" />
        <Tile label="Reported sick" value={fmtInt(reportedSickToday)} foot="FormSG" />
        <Tile label="MC / MA" value={fmtInt(duty ? distinctDutyOn(data.personnel, today, SESSION, MC_MA) : 0)} />
        <Tile label="On status" value={fmtInt(duty ? duty.counts[DUTY_CLASS.STATUS] || 0 : 0)} />
      </TileRow>
      <Coverage>{coverageLine}</Coverage>

      <div class="grid-2">
        <ChartCard
          title="Out of Camp, by Reason"
          note={'Soldiers named as absent on the ' + fmtDate(today) + ' parade state'}
          empty={hasParadeState ? 'Nobody is listed as absent.' : 'No parade state filed for this day.'}
        >
          <Donut slices={duty ? absenceParts(duty) : []} valueName="soldiers" />
        </ChartCard>
        <TierCard strength={data.strength} date={today} scoped={Boolean(scopedCompany)} />
      </div>

      <h2 class="section-title">Next {DEFAULT_PROJECTION_DAYS} Days</h2>
      <ReturnsCard data={data} date={today} />
      <RecentReturnsCard data={data} date={today} />

      <h2 class="section-title">Trends</h2>
      <div class="grid-2">
        <TrendSection
          title="Soldiers Present"
          coverage="Present strength on each parade; a day with no parade state reads zero."
          range={range}
          trendFn={(scope, days) => presentTrend(data.strength, days, { scope, session: SESSION })}
        />
        <SickSourcesCard data={data} submissions={submissions} range={range} />
        <TrendSection title="MC / MA" coverage={trendCoverage} range={range} trendFn={dutyTrendFn(MC_MA)} />
        <TrendSection title="Status" coverage={trendCoverage} range={range} trendFn={dutyTrendFn(DUTY_CLASS.STATUS)} />
      </div>

      <SankeyCard episodes={episodes} submissions={submissions} from={dateFrom.value} to={dateTo.value} />
    </div>
  );
}
