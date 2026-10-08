/**
 * Filing & Accuracy: whether the parade states arrive on time and say what they list, and
 * how much of the battalion the data covers.
 */

import { useMemo } from 'preact/hooks';
import { company } from '../app/state.js';
import { Banner, Card } from '../components/Card.jsx';
import { ChartCard, Heatmap } from '../charts/index.js';
import { fmtDate, fmtFraction, fmtInt } from '../format.js';
import { COMPANIES } from '../../../shared/domain.js';
import { withinRange } from '../model/dateRange.js';
import { countMismatches, dataQuality } from '../model/quality.js';
import { ALL_COMPANIES } from '../model/scope.js';
import { FILING_CUTOFF_MINUTES, filingTimes, toFilings } from '../model/submissions.js';
import { CategoryPage, useCategory } from './shared/category.jsx';

/**
 * A count of minutes after midnight as a clock time.
 * @param {number} minutes Minutes after midnight.
 * @returns {string} `HH:mm`.
 */
function fmtClock(minutes) {
  return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
}

/**
 * The data-quality panel: row counts, tab availability, date spans, and the named
 * findings from `model/quality.js`.

 * @param {!Object} quality The result of `dataQuality`.
 * @returns {!preact.VNode} The panel.
 */
function DataQualityPanel({ quality }) {
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

  const optionalTabNotes = Object.entries(quality.optionalTabs);

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

      {optionalTabNotes.length > 0 ? (
        <div class="band">
          {optionalTabNotes.map(([tab, note]) => (
            <Banner tone="warning" key={tab}>
              {note}
            </Banner>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

/**
 * How late each company's first parade state arrived, day by day.
 * @param {{filings: Array<!Object>, range: !Object}} props Filings from `toFilings`
 *     (already scoped), and the range.
 * @returns {!preact.VNode} The card.
 */
function TimelinessCard({ filings, range }) {
  const { cells, onTime, filed, nextDay } = filingTimes(filings, range.days);
  const companies = COMPANIES.filter((company) => filed[company] > 0);
  return (
    <ChartCard
      title="First Parade State, Minutes Late"
      note={
        'Minutes past ' + fmtClock(FILING_CUTOFF_MINUTES) + ' the first parade state arrived; 0 is on time. On time: ' +
        companies.map((company) => company + ' ' + fmtFraction(onTime[company], filed[company])).join(', ') + '.'
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

/**
 * Sections whose stated count differs from the names listed under them, by company and day.
 * @param {{sectionCounts: Array<!Object>, personnel: Array<!Object>, range: !Object}} props
 *     The scoped stated counts and personnel rows, and the range.
 * @returns {!preact.VNode} The card.
 */
function AccuracyCard({ sectionCounts, personnel, range }) {
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

/**
 * The Filing & Accuracy page.
 * @returns {!preact.VNode} The page.
 */
export function Filing() {
  const { data, range } = useCategory();
  const filings = useMemo(
    () => toFilings(data.submissions).filter((filing) => company.value === ALL_COMPANIES || filing.company === company.value),
    [data.submissions, company.value]
  );
  const sectionCounts = useMemo(
    () => (data.sectionCounts || []).filter((row) => company.value === ALL_COMPANIES || row.company === company.value),
    [data.sectionCounts, company.value]
  );
  return (
    <CategoryPage title="Filing & Accuracy" range={range}>
      <TimelinessCard filings={filings} range={range} />
      <AccuracyCard sectionCounts={sectionCounts} personnel={data.personnel} range={range} />
      <DataQualityPanel quality={dataQuality(data)} />
    </CategoryPage>
  );
}
