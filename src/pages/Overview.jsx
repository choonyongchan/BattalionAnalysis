/**
 * Battalion overview: who has filed this morning, today's numbers, and how the battalion
 * is trending.
 *
 * Two clocks run on this page and they answer different questions. `selectedDate` names
 * one parade — the filing chips and the tile row describe that single day and ignore the
 * range entirely, because "today's strength" should never sit under a span a reader has
 * to remember is active. `dateFrom`/`dateTo` bound every trend and the Sankey; null on
 * both means "all data", the long-standing default. `company` narrows every panel on the
 * page to one company, or `ALL` for the whole battalion — applied once, upstream, by
 * `scopeDataset`, so each rate is still a company's own numerator over its own
 * denominator.
 *
 * The selected parade also anchors the one forward-looking section: presence by rank tier,
 * then projected % present over the next week from the dates each absence states
 * (`model/projection.js`), and the list of who is due back when.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { company, dataset, dateFrom, dateTo, selectedDate } from '../app/state.js';
import { Card, Coverage, EmptyState } from '../components/Card.jsx';
import { DataTable } from '../components/Table.jsx';
import { Tile, TileRow } from '../components/Tile.jsx';
import { Segmented, SCOPE_OPTIONS } from '../components/Segmented.jsx';
import { PageControls } from '../components/PageControls.jsx';
import { FilingChips } from '../components/FilingChips.jsx';
import { fmtDate, fmtFraction, fmtInt, fmtPercent } from '../format.js';
import { ChartCard, Line, Sankey } from '../charts/index.js';
import { COMPANIES } from '../model/domain.js';
import { DUTY_CLASS, MC_MA } from '../model/classify.js';
import { ALL_COMPANIES, scopeDataset, scopeFilings, scopeSubmissions } from '../model/scope.js';
import { toHolidays, holidaysIn, weekendBands } from '../model/calendarMarks.js';
import { datesPresent, battalionStrength, dutyCountsOn } from '../model/metrics.js';
import { eachDay } from '../model/dateRange.js';
import { buildEpisodes } from '../model/episodes.js';
import { toSubmissions, submissionTrend } from '../model/formsg.js';
import { filingsOn, toFilings } from '../model/submissions.js';
import { dutyTrend, presentTrend, tierPresence } from '../model/strength.js';
import { DEFAULT_PROJECTION_DAYS, projectedStrength, returnsToDuty } from '../model/projection.js';
import { addDays } from '../model/dates.js';
import { reportSickFlow } from '../model/sankey.js';

/** @type {string} Session every "today" figure and trend describes. */
const SESSION = 'FPS';

/**
 * Counts distinct soldiers reporting sick on one parade (`Report Sick` category), for the
 * tile row — `dutyCountsOn` already gives this via its `counts` map.
 * @param {!Object} duty A `dutyCountsOn` result.
 * @param {string} dutyClass A DUTY_CLASS value.
 * @returns {number} The count.
 */
function countOf(duty, dutyClass) {
  return duty.counts[dutyClass] || 0;
}

/**
 * A trend card: a Line chart plus its Battalion/Companies toggle, sharing one layout so
 * all five trend cards on this page read as the same kind of thing.
 *
 * When a single company is selected in the page bar the toggle is meaningless — there is
 * no Battalion-vs-Companies distinction with one company — so it is hidden and the chart
 * draws that company's one line, kept in its own colour slot so it matches every other
 * page.
 * @param {{title: string, trendFn: function(string): !Object, coverage: string,
 *     unit?: string}} props The card title, a function from scope name to a trend result,
 *     the coverage line, and the axis unit.
 * @returns {!preact.VNode} The card.
 */
function TrendCard({ title, trendFn, coverage, unit }) {
  const scopedCompany = company.value !== ALL_COMPANIES ? company.value : null;
  const [scope, setScope] = useState('battalion');
  const effectiveScope = scopedCompany ? 'battalion' : scope;
  const trend = trendFn(effectiveScope);

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
          weekends={trend.weekends}
          holidays={trend.holidays}
          valueName={unit}
        />
      </ChartCard>
      {!scopedCompany && effectiveScope === 'companies' ? (
        <p class="chart-hint">Tap on the company to hide</p>
      ) : null}
    </Card>
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

  const effectiveFrom = dateFrom.value || paradeDates[0] || today;
  const effectiveTo = dateTo.value || paradeDates[paradeDates.length - 1] || today;
  const trendDates = useMemo(
    () => eachDay(effectiveFrom, effectiveTo),
    [effectiveFrom, effectiveTo]
  );
  const weekends = useMemo(
    () => weekendBands(effectiveFrom, effectiveTo),
    [effectiveFrom, effectiveTo]
  );
  const rangeHolidays = useMemo(
    () => holidaysIn(holidays, effectiveFrom, effectiveTo),
    [holidays, effectiveFrom, effectiveTo]
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
  const duty = dutyCountsOn(data.personnel, today, SESSION);
  const reportedSickToday = submissions.filter((submission) => submission.date === today).length;
  const filingEntries = scopeFilings(filingsOn(filings, today, SESSION), company.value);

  const coverageLine = scopedCompany
    ? scopedCompany +
      ' only — parade state for ' +
      fmtDate(today) +
      (strength.companiesReporting.length > 0 ? ' filed.' : ' not filed.')
    : 'Accurate to the parade states filed for ' +
      fmtDate(today) +
      ' — ' +
      fmtFraction(strength.companiesReporting.length, COMPANIES.length) +
      ' companies.';

  const trendCoverage =
    'Battalion strength observed on ' +
    fmtFraction(trendDates.length, trendDates.length) +
    ' days in range; a company not filing that day is drawn as a gap.';

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
        <Tile label="Present soldiers" value={fmtInt(strength.present)} />
        <Tile label="% present" value={fmtPercent(strength.percentPresent / 100)} />
        <Tile label="Reporting sick" value={fmtInt(countOf(duty, DUTY_CLASS.REPORT_SICK))} foot="Parade state" />
        <Tile label="Reported sick" value={fmtInt(reportedSickToday)} foot="FormSG" />
        <Tile
          label="MC / MA"
          value={fmtInt(MC_MA.reduce((sum, dutyClass) => sum + countOf(duty, dutyClass), 0))}
        />
        <Tile label="On status" value={fmtInt(countOf(duty, DUTY_CLASS.STATUS))} />
      </TileRow>
      <Coverage>{coverageLine}</Coverage>

      <TierCard strength={data.strength} date={today} scoped={Boolean(scopedCompany)} />

      <div class="band">
        <h2 class="pagehead__title" style="font-size:21px">
          Next {DEFAULT_PROJECTION_DAYS} Days
        </h2>
      </div>

      <ProjectionCards data={data} date={today} holidays={holidays} />

      <div class="band">
        <h2 class="pagehead__title" style="font-size:21px">
          Trends
        </h2>
      </div>

      <TrendCard
        title="% present"
        coverage={trendCoverage}
        unit="%"
        trendFn={(scope) => {
          const trend = presentTrend(data.strength, trendDates, { scope, session: SESSION });
          return { ...trend, weekends, holidays: rangeHolidays };
        }}
      />

      <TrendCard
        title="Reporting Sick (Parade State)"
        coverage={trendCoverage}
        unit="per 100"
        trendFn={(scope) => {
          const trend = dutyTrend(data.personnel, data.strength, DUTY_CLASS.REPORT_SICK, trendDates, {
            scope,
            session: SESSION,
          });
          return { ...trend, weekends, holidays: rangeHolidays };
        }}
      />

      <TrendCard
        title="Reported Sick (FormSG)"
        coverage={
          'FormSG submissions; a company with no submissions in range is drawn flat at zero, not a gap.'
        }
        unit="per 100"
        trendFn={(scope) => {
          const trend = submissionTrend(submissions, data.strength, trendDates, { scope, session: SESSION });
          return { ...trend, weekends, holidays: rangeHolidays };
        }}
      />

      <TrendCard
        title="MC / MA"
        coverage={trendCoverage}
        unit="per 100"
        trendFn={(scope) => {
          const trend = dutyTrend(data.personnel, data.strength, MC_MA, trendDates, {
            scope,
            session: SESSION,
          });
          return { ...trend, weekends, holidays: rangeHolidays };
        }}
      />

      <TrendCard
        title="Status"
        coverage={trendCoverage}
        unit="per 100"
        trendFn={(scope) => {
          const trend = dutyTrend(data.personnel, data.strength, DUTY_CLASS.STATUS, trendDates, {
            scope,
            session: SESSION,
          });
          return { ...trend, weekends, holidays: rangeHolidays };
        }}
      />

      <Card
        title="Report-Sick Flow"
        note="Reconciled per company by 4D, else name; type and outcome are per FormSG submission."
      >
        <SankeyCard
          personnel={data.personnel}
          episodes={episodes}
          submissions={submissions}
          from={dateFrom.value}
          to={dateTo.value}
        />
      </Card>
    </div>
  );
}

/**
 * The report-sick Sankey, with its coverage findings printed under it.
 * @param {{personnel: Array<!Object>, episodes: Array<!Object>, submissions:
 *     Array<!Object>, from: ?string, to: ?string}} props Inputs to `reportSickFlow`.
 * @returns {!preact.VNode} The card body.
 */
function SankeyCard({ personnel, episodes, submissions, from, to }) {
  const flow = useMemo(
    () => reportSickFlow({ personnel, episodes, submissions, from, to }),
    [personnel, episodes, submissions, from, to]
  );
  const c = flow.coverage;

  return (
    <>
      <ChartCard title="">
        <Sankey nodes={flow.nodes} links={flow.links} />
      </ChartCard>
      <Coverage>
        {fmtInt(c.reportingSick)} reporting sick on the parade state, {fmtInt(c.reportedSick)} reported
        sick on FormSG — {fmtInt(c.matched)} both, {fmtInt(c.paradeOnly)} filed no form,{' '}
        {fmtInt(c.unaccounted)} unaccounted (FormSG with no parade-state line).
        {c.companiesWithNoFormSg && c.companiesWithNoFormSg.length > 0
          ? ' No FormSG channel recorded for ' + c.companiesWithNoFormSg.join(', ') + '.'
          : ''}
        {c.submissionFanout
          ? ' A soldier who filed more than one form is one person on the left and several submissions on the right, so the FormSG branch is wider than the soldier count.'
          : ''}
        {c.statusMultiLabelled
          ? ' A status outcome naming several restrictions is counted under each — the Status branch\'s outflow can exceed its inflow.'
          : ''}
      </Coverage>
    </>
  );
}

/**
 * Formats one tier cell: the percentage present, then present over strength.
 * @param {{strength: ?number, present: ?number, percent: ?number}} tier A tier total.
 * @returns {string} e.g. '91% (111/122)', or '—' when the tier was not stated.
 */
function tierCell(tier) {
  if (tier.strength === null) {
    return '—';
  }
  return fmtPercent(tier.percent / 100) + ' (' + fmtInt(tier.present) + '/' + fmtInt(tier.strength) + ')';
}

/**
 * Presence by rank tier on one parade: a row per company that filed, under a battalion row.
 * @param {{strength: Array<!Object>, date: string, scoped: boolean}} props The scoped
 *     Strength Data, the parade date, and whether one company is selected (no battalion row).
 * @returns {!preact.VNode} The card.
 */
function TierCard({ strength, date, scoped }) {
  const tiers = tierPresence(strength, date, SESSION);
  const rows = [
    ...(scoped ? [] : [{ unit: 'Battalion', tiers: tiers.battalion }]),
    ...tiers.byCompany.map((entry) => ({ unit: entry.company, tiers: entry.tiers })),
  ];

  return (
    <Card title="Presence by Rank" note="Officers, WOSpecs and enlistees present, as the parade state splits them">
      {tiers.byCompany.length === 0 ? (
        <EmptyState>No parade state filed for {fmtDate(date)}.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'unit', label: 'Unit' },
            { key: 'officer', label: 'Officers', numeric: true },
            { key: 'wospec', label: 'WOSpecs', numeric: true },
            { key: 'enlistee', label: 'Enlistees', numeric: true },
          ]}
          rows={rows.map((row) => ({
            unit: row.unit,
            ...Object.fromEntries(row.tiers.map((tier) => [tier.key, tierCell(tier)])),
          }))}
          rowKey={(row) => row.unit}
        />
      )}
      {tiers.companiesWithoutSplit.length > 0 ? (
        <Coverage>No rank split stated by {tiers.companiesWithoutSplit.join(', ')}.</Coverage>
      ) : null}
    </Card>
  );
}

/**
 * The forward view: projected % present over the coming days, and who is due back when.
 * @param {{data: !Object, date: string, holidays: Array<!Object>}} props The scoped
 *     dataset, the parade the projection starts from, and the public holidays.
 * @returns {!preact.VNode} The two cards.
 */
function ProjectionCards({ data, date, holidays }) {
  const end = addDays(date, DEFAULT_PROJECTION_DAYS);
  const weekends = weekendBands(date, end);
  const windowHolidays = holidaysIn(holidays, date, end);
  const base = projectedStrength(data.personnel, data.strength, date, { session: SESSION });
  const returns = returnsToDuty(data.personnel, date, SESSION);

  const coverage =
    'Projected from the parade state for ' +
    fmtDate(date) +
    ' (' +
    fmtFraction(base.companiesReporting.length, COMPANIES.length) +
    ' companies) using the dates each MC and leave states; MA, others and status do not keep a soldier off parade, and nobody new is assumed to fall sick. ' +
    (base.openEnded > 0
      ? fmtInt(base.openEnded) + ' on MC or leave with no return date are held out for the whole week.'
      : 'Every MC and leave states a return date.');

  return (
    <>
      <TrendCard
        title="Projected % present"
        coverage={coverage}
        unit="%"
        trendFn={(scope) => ({
          ...projectedStrength(data.personnel, data.strength, date, { session: SESSION, scope }),
          weekends,
          holidays: windowHolidays,
        })}
      />
      <Card title="Returning to Duty" note="Everyone on MC or leave on this parade, soonest back first">
        {returns.length === 0 ? (
          <EmptyState>Nobody is listed on MC or leave on {fmtDate(date)}.</EmptyState>
        ) : (
          <DataTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'company', label: 'Company' },
              { key: 'platoon', label: 'Platoon' },
              { key: 'category', label: 'Category' },
              { key: 'from', label: 'From' },
              { key: 'back', label: 'Back on' },
            ]}
            rows={returns.map((row) => ({
              ...row,
              name: (row.rank + ' ' + row.name).trim(),
              from: fmtDate(row.from),
              back: row.backOn ? fmtDate(row.backOn) : 'Not stated',
            }))}
            rowKey={(row) => row.company + row.key}
          />
        )}
      </Card>
    </>
  );
}
