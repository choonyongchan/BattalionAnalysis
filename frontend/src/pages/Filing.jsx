/**
 * Filing & Accuracy: whether the parade states arrive on time and say what they list, and
 * how much of the battalion the data covers.
 */

import { dataset } from '../app/state.js';
import { Banner, Card } from '../components/Card.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../format.js';
import { dataQuality } from '../model/quality.js';

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
 * The Filing & Accuracy page.
 * @returns {!preact.VNode} The page.
 */
export function Filing() {
  const data = dataset.value;
  if (!data) {
    return null;
  }
  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Filing &amp; Accuracy</h1>
          <p class="pagehead__sub">Whether parade states arrive on time and add up, and what the data covers.</p>
        </div>
      </header>
      <DataQualityPanel quality={dataQuality(data)} />
    </div>
  );
}
