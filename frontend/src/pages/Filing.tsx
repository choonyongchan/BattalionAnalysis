/**
 * Filing & Accuracy: whether the parade states arrive on time and say what they list, and
 * how much of the battalion the data covers.
 */

import { useMemo } from 'preact/hooks';
import { company } from '../app/state.ts';
import { Banner, Card } from '../components/Card.tsx';
import { ChartCard, Heatmap } from '../charts/index.ts';
import { fmtClock, fmtDate, fmtFraction, fmtInt } from '../format.ts';
import { COMPANIES } from '../../../shared/domain.ts';
import { withinRange } from '../model/dateRange.ts';
import { countMismatches, dataQuality, type DataQuality } from '../model/quality.ts';
import { onlyCompany } from '../model/scope.ts';
import { FILING_CUTOFF_MINUTES, filingTimes, toFilings, type Filing as FilingRecord } from '../model/submissions.ts';
import type { PersonnelRow, SectionCountRow } from '../../../shared/dashboard.ts';
import { CategoryPage, useCategory, type CategoryRange } from './shared/category.tsx';

/** The data-quality panel: row counts, date spans and the findings from `model/quality.ts`. */
function DataQualityPanel({ quality }: { quality: DataQuality }) {
  const rows = [
    { label: 'Strength Data rows', value: fmtInt(quality.rowCounts.strength) },
    { label: 'Personnel Data rows', value: fmtInt(quality.rowCounts.personnel) },
    { label: 'Command Roster rows', value: fmtInt(quality.rowCounts.roster) },
    { label: 'FormSG submissions', value: fmtInt(quality.rowCounts.formSg) },
    { label: 'Parade-state filings read', value: fmtInt(quality.rowCounts.submissions) },
    {
      label: 'Rows under a known platoon sub-header',
      value:
        fmtFraction(quality.platoon.stated, quality.platoon.total) +
        '; 4D names another platoon on ' +
        fmtInt(quality.platoon.fourDDisagrees),
    },
    { label: 'Personnel rows with no 4D', value: fmtFraction(quality.fourD.blank, quality.fourD.total) },
    {
      label: 'Status rows with no stated duration',
      value: fmtFraction(quality.statusDuration.blank, quality.statusDuration.total),
    },
    {
      label: 'Att C (MC) rows with no stated duration',
      value: fmtFraction(quality.attCDuration.blank, quality.attCDuration.total),
    },
  ];

  const notes = Object.entries(quality.notes);

  return (
    <Card title="Data Quality">
      <div class="tablewrap">
        <table>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td class="num">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p class="caption">
        Parade-state data: {quality.paradeStateSpan.from ? fmtDate(quality.paradeStateSpan.from) + ' – ' + fmtDate(quality.paradeStateSpan.to) : 'no data loaded'}.
        {' '}FormSG data: {quality.formSgSpan.from ? fmtDate(quality.formSgSpan.from) + ' – ' + fmtDate(quality.formSgSpan.to) : 'no data loaded'}.
        {' '}"All" means a different span on each chart.
      </p>

      {quality.permanentStatusSentinel.readAsPermanent > 0 &&
      quality.permanentStatusSentinel.carryingSentinel === 0 ? (
        <Banner tone="warning">
          {fmtInt(quality.permanentStatusSentinel.readAsPermanent)} Status rows read as
          permanent from their reason text, but none carries the sentinel the parser is
          meant to write for a permanent status. Leaderboards fall back to the reason text;
          this is a parser-side finding worth a separate look.
        </Banner>
      ) : null}

      {notes.length > 0 ? (
        <div class="band">
          {notes.map(([key, note]) => (
            <Banner tone="warning" key={key}>
              {note}
            </Banner>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/** How late each company's first parade state arrived, day by day. */
function TimelinessCard({ filings, range }: { filings: FilingRecord[]; range: CategoryRange }) {
  const { cells, onTime, filed, nextDay } = filingTimes(filings, range.days);
  const companies = COMPANIES.filter((company) => (filed[company] ?? 0) > 0);
  return (
    <ChartCard
      title="First Parade State, Minutes Late"
      note={
        'Minutes past ' + fmtClock(FILING_CUTOFF_MINUTES) + ' the first parade state arrived; 0 is on time. On time: ' +
        companies.map((company) => company + ' ' + fmtFraction(onTime[company] ?? 0, filed[company] ?? 0)).join(', ') + '.'
      }
      coverage={
        'A blank cell is a day with no filing' +
        (nextDay > 0 ? ', or one of the ' + fmtInt(nextDay) + ' parade states filed on a later day.' : '.')
      }
      empty="No parade state filed in range."
    >
      <Heatmap
        rows={companies}
        columns={range.days}
        cells={cells}
        valueName="minutes late"
        detail={(cell) => ['Arrived ' + cell.at]}
        showValues
        height={Math.max(160, companies.length * 36 + 60)}
      />
    </ChartCard>
  );
}

/** Sections whose stated count differs from the names listed under them, by company and day. */
function AccuracyCard({ sectionCounts, personnel, range }: { sectionCounts: SectionCountRow[]; personnel: PersonnelRow[]; range: CategoryRange }) {
  const inRange = sectionCounts.filter((row) => withinRange(row.date, range.from, range.to));
  const { cells, checked, mismatched } = countMismatches(inRange, personnel);
  const companies = COMPANIES.filter((company) => cells.some((cell) => cell.row === company));
  return (
    <ChartCard
      title="Sections That Do Not Add Up"
      note={fmtInt(mismatched) + ' of ' + fmtInt(checked) + ' section headers state a count that differs from the names listed under them.'}
      coverage="Each cell counts one company's mismatched sections that day; hover for which."
      empty="No stated section counts in range."
    >
      <Heatmap
        rows={companies}
        columns={range.days}
        cells={cells}
        valueName="sections"
        detail={(cell) => cell.sections}
        showValues
        height={Math.max(160, companies.length * 36 + 60)}
      />
    </ChartCard>
  );
}

/** The Filing & Accuracy page. */
export function Filing() {
  const { data, range } = useCategory();
  // Filing rows carry no company column; the id names it.
  const filings = useMemo(() => onlyCompany(toFilings(data.submissions), company.value), [data.submissions, company.value]);
  return (
    <CategoryPage title="Filing & Accuracy" range={range}>
      <TimelinessCard filings={filings} range={range} />
      <AccuracyCard sectionCounts={data.sectionCounts} personnel={data.personnel} range={range} />
      <DataQualityPanel quality={dataQuality(data)} />
    </CategoryPage>
  );
}
