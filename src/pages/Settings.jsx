/**
 * What the dashboard is reading, and how much of the battalion it covers.
 *
 * Read-only, and deliberately so: the dashboard reads Neon as a role that cannot write
 * (`docs/architecture_patterns.md`), so a wrong holiday or an overlapping rotation is
 * fixed in the database with SQL, not here. This page's job is to make a problem visible
 * and name the exact table and columns to fill when a settings table is empty.
 */

import { dataset } from '../app/state.js';
import { Banner, Card, EmptyState } from '../components/Card.jsx';
import { DataTable } from '../components/Table.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../format.js';
import { TABS } from '../data/tabs.js';
import { toHolidays } from '../model/calendarMarks.js';
import { dataQuality } from '../model/quality.js';
import { rotationIssues, rotationSpan, toRotations } from '../model/rotations.js';
import { weekdayOf } from '../model/dates.js';

/**
 * The panel shown when a settings table has no rows: which table to fill, and how.
 * @param {{tabName: string, table: string, example: string}} props The panel title, the
 *     Neon table, and an example INSERT.
 * @returns {!preact.VNode} The panel.
 */
function EmptySettingsPanel({ tabName, table, example }) {
  return (
    <Card title={tabName}>
      <Banner tone="warning">
        The <strong>{table}</strong> table has no rows yet. Add them in the Neon SQL editor as
        the database owner, then reload the dashboard:
      </Banner>
      <p class="fine">{example}</p>
    </Card>
  );
}

/**
 * The Public Holidays panel: a table of what loaded, each with its weekday.
 * @param {Array<!Object>} rows Raw "Public Holidays" records.
 * @returns {!preact.VNode} The panel.
 */
function HolidaysPanel({ rows }) {
  const holidays = toHolidays(rows);
  if (holidays.length === 0) {
    return (
      <Card title="Public Holidays">
        <EmptyState>No public holidays loaded for the range this dashboard has read.</EmptyState>
      </Card>
    );
  }
  return (
    <Card title="Public Holidays" note={fmtInt(holidays.length) + ' loaded'}>
      <DataTable
        columns={[
          { key: 'date', label: 'Date' },
          { key: 'weekday', label: 'Weekday' },
          { key: 'name', label: 'Name' },
        ]}
        rows={holidays.map((holiday) => ({
          date: fmtDate(holiday.date),
          weekday: weekdayOf(holiday.date).name,
          name: holiday.name,
        }))}
        rowKey={(row, index) => row.date + index}
      />
    </Card>
  );
}

/**
 * The Rotations panel: the schedule, its outer span, and any gap/overlap/invalid issues.
 * @param {Array<!Object>} rows Raw "Rotations" records.
 * @returns {!preact.VNode} The panel.
 */
function RotationsPanel({ rows }) {
  const rotations = toRotations(rows);
  if (rotations.length === 0) {
    return (
      <Card title="Rotations">
        <EmptyState>No rotation schedule loaded. Rotational grouping is unavailable.</EmptyState>
      </Card>
    );
  }
  const issues = rotationIssues(rotations);
  const span = rotationSpan(rotations);
  return (
    <Card
      title="Rotations"
      note={span ? fmtDate(span.start) + ' – ' + (span.end ? fmtDate(span.end) : 'ongoing') : ''}
    >
      <DataTable
        columns={[
          { key: 'name', label: 'Name' },
          { key: 'start', label: 'Start' },
          { key: 'end', label: 'End' },
        ]}
        rows={rotations.map((rotation) => ({
          name: rotation.name,
          start: fmtDate(rotation.start),
          end: rotation.end ? fmtDate(rotation.end) : 'Ongoing',
        }))}
        rowKey={(row) => row.name}
      />
      {issues.length > 0 ? (
        <div class="band">
          {issues.map((issue, index) => (
            <Banner tone={issue.kind === 'invalid' ? 'error' : 'warning'} key={index}>
              {issue.message}
            </Banner>
          ))}
        </div>
      ) : (
        <p class="caption">No gaps or overlaps found.</p>
      )}
    </Card>
  );
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
      label: 'Platoon stated vs inferred',
      value:
        fmtFraction(quality.platoon.stated, quality.platoon.total) +
        ' stated, ' +
        fmtFraction(quality.platoon.inferred, quality.platoon.total) +
        ' inferred',
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

      {Object.keys(quality.optionalTabs).length > 0 ? (
        <div class="band">
          {Object.entries(quality.optionalTabs).map(([tab, note]) => (
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
 * The Settings page.
 * @returns {!preact.VNode} The page.
 */
export function Settings() {
  const data = dataset.value;
  if (!data) {
    return null;
  }

  const quality = dataQuality(data);

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Settings</h1>
          <p class="pagehead__sub">What the dashboard is reading, and how much it covers.</p>
        </div>
      </header>

      <div class="grid-2">
        {data.available.holidays ? (
          <HolidaysPanel rows={data.holidays} />
        ) : (
          <EmptySettingsPanel
            tabName={TABS.HOLIDAYS}
            table="public_holidays"
            example="INSERT INTO public_holidays (date, name) VALUES ('2026-08-09', 'National Day');"
          />
        )}
        {data.available.rotations ? (
          <RotationsPanel rows={data.rotations} />
        ) : (
          <EmptySettingsPanel
            tabName={TABS.ROTATIONS}
            table="rotations"
            example="INSERT INTO rotations (name, start_date, end_date) VALUES ('Rotation 1', '2026-07-01', '2026-09-30');"
          />
        )}
      </div>

      <DataQualityPanel quality={quality} />
    </div>
  );
}
