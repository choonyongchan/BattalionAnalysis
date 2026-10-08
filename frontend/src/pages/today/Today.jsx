/**
 * Today: who has filed this morning and today's numbers. Trends over a range live on the
 * Trends page.
 *
 * `selectedDate` names one parade — the filing chips, the tile row and the absence ring
 * describe that single day. `company` narrows every panel on the page to one company, or
 * `ALL` for the whole battalion — applied once, upstream, by `scopeDataset`.
 *
 * The selected parade also anchors the one forward-looking section: presence by rank tier,
 * then the list of who is due back when, from the dates each absence states
 * (`model/projection.js`), and who has just come off MC or Light Duty (`model/recentReturns.js`).
 */

import { useEffect, useMemo, useRef } from 'preact/hooks';
import { company, dataset, selectedDate } from '../../app/state.js';
import { Card, Coverage, EmptyState } from '../../components/Card.jsx';
import { Tile, TileRow } from '../../components/Tile.jsx';
import { PageControls } from '../../components/PageControls.jsx';
import { FilingChips } from '../../components/FilingChips.jsx';
import { fmtDate, fmtFraction, fmtInt, fmtPercent } from '../../format.js';
import { ChartCard, Donut } from '../../charts/index.js';
import { COMPANIES } from '../../../../shared/domain.js';
import { DUTY_CLASS, MC_MA } from '../../model/classify.js';
import { ALL_COMPANIES, scopeDataset, scopeFilings, scopeSubmissions } from '../../model/scope.js';
import { absenceParts, datesPresent, battalionStrength, dutyCountsOn, distinctDutyOn } from '../../model/metrics.js';
import { toSubmissions } from '../../model/formsg.js';
import { filingsOn, toFilings } from '../../model/submissions.js';
import { DEFAULT_PROJECTION_DAYS } from '../../model/projection.js';
import { RecentReturnsCard, ReturnsCard, TierCard } from './cards.jsx';

/** @type {string} Session every "today" figure and trend describes. */
const SESSION = 'FPS';


/**
 * The Today page.
 * @returns {!preact.VNode} The page.
 */
export function Today() {
  const full = dataset.value;
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const scopedCompany = company.value !== ALL_COMPANIES ? company.value : null;

  const submissions = useMemo(
    () => scopeSubmissions(toSubmissions(data.formSg), company.value),
    [data.formSg, company.value]
  );
  const filings = useMemo(() => toFilings(data.submissions), [data.submissions]);
  // The selectable dates come from the full, unscoped strength so they
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

  if (!today) {
    return (
      <div class="page">
        <header class="pagehead">
          <h1 class="pagehead__title">Today</h1>
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

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Today</h1>
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

    </div>
  );
}
