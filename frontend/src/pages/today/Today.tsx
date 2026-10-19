/**
 * Today: who has filed and the numbers for one parade (`selectedDate`), then who is due back and who has just
 * returned. Trends over a range are on the Trends page.
 */

import { useEffect, useMemo, useRef } from 'preact/hooks';
import { company, loadedData, selectedDate } from '../../app/state.ts';
import { Card, Coverage, EmptyState } from '../../components/Card.tsx';
import { Tile, TileRow } from '../../components/Tile.tsx';
import { PageControls } from '../../components/PageControls.tsx';
import { FilingChips } from '../../components/FilingChips.tsx';
import { fmtDate, fmtFraction, fmtInt, fmtPercent } from '../../format.ts';
import { ChartCard, Donut } from '../../charts/index.ts';
import { COMPANIES, isCompany } from '../../../../shared/domain.ts';
import { DUTY_CLASS, MC_MA } from '../../model/classify.ts';
import { onlyCompany, scopeDataset } from '../../model/scope.ts';
import { absenceParts, datesPresent, battalionStrength, dutyCountsOn, distinctDutyOn } from '../../model/metrics.ts';
import { toSubmissions } from '../../model/formsg.ts';
import { filingsOn, toFilings } from '../../model/submissions.ts';
import { AwayAheadCard, OtherDutiesCard, RecentReturnsCard, RestrictionsCard, ReturnsCard, TierCard } from './cards.tsx';

/** Session every "today" figure and trend describes. */
const SESSION = 'FPS';

/** The Today page. */
export function Today() {
  const full = loadedData();
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const scopedCompany = isCompany(company.value) ? company.value : null;

  const submissions = useMemo(() => toSubmissions(data.formSg), [data.formSg]);
  const filings = useMemo(() => toFilings(data.submissions), [data.submissions]);
  // The selectable dates come from the full, unscoped strength so they
  // do not shrink when a company that filed on fewer days is picked.
  const paradeDates = useMemo(() => datesPresent(full.strength), [full.strength]);

  // Follow the newest parade: on first open, and when a background refresh brings a new
  // day while the viewer was looking at the latest one. A date picked by hand stays put.
  const latestSeen = useRef<string | null>(null);
  useEffect(() => {
    const latest = paradeDates[paradeDates.length - 1] ?? null;
    if (!selectedDate.value || selectedDate.value === latestSeen.current) {
      selectedDate.value = latest;
    }
    latestSeen.current = latest;
  }, [paradeDates]);

  const today = selectedDate.value ?? paradeDates[paradeDates.length - 1] ?? null;

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
  const filingEntries = onlyCompany(filingsOn(filings, today, SESSION), company.value);

  const coverageLine = scopedCompany
    ? scopedCompany + ' only: parade state for ' + fmtDate(today) + (hasParadeState ? ' filed.' : ' not filed.')
    : `Accurate to the parade states filed for ${fmtDate(today)}, ${fmtFraction(strength.companiesReporting.length, COMPANIES.length)} companies.`;

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Today</h1>
          <p class="pagehead__sub">{fmtDate(today)}</p>
        </div>
      </header>

      <PageControls min={paradeDates[0] ?? today} max={paradeDates[paradeDates.length - 1] ?? today} />

      <Card
        title="Today's First Parade State"
        note="Lit in the company's colour once its first parade state reaches the database; the time is when it was received"
      >
        <FilingChips entries={filingEntries} />
      </Card>

      <TileRow>
        <Tile label="Total soldiers" value={fmtInt(strength.accountable)} />
        <Tile label="Present soldiers" value={fmtInt(hasParadeState ? strength.present : 0)} />
        <Tile label="% present" value={fmtPercent(strength.percentPresent === null ? null : strength.percentPresent / 100)} />
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
        <OtherDutiesCard data={data} date={today} />
        <RestrictionsCard data={data} date={today} />
        <TierCard strength={data.strength} date={today} scoped={Boolean(scopedCompany)} />
      </div>

      <h2 class="section-title">Ahead</h2>
      <AwayAheadCard data={data} date={today} />
      <ReturnsCard data={data} date={today} />
      <RecentReturnsCard data={data} date={today} />
    </div>
  );
}
