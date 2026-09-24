/**
 * What this dashboard is set up for, and how much of the battalion it covers.
 *
 * Every viewer sees every setting; a viewer holding the settings password can also change
 * one, section by section, from the Basic and Advanced tabs below. Each section's card says
 * when it is still the default. Settings are no longer maintained by SQL: holidays and
 * rotations are edited under Settings → Calendar, alongside Unit, Thresholds and Session.
 */

import { useState } from 'preact/hooks';
import { canEdit, dataset } from '../app/state.js';
import { Banner, Card } from '../components/Card.jsx';
import { Segmented } from '../components/Segmented.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../format.js';
import { dataQuality } from '../model/quality.js';
import { rotationIssues, toRotations } from '../model/rotations.js';
import { SECTIONS } from '../model/settings/defaults.js';
import { SectionCard } from './settings/SectionCard.jsx';
import {
  CalendarEditor,
  CalendarView,
  SessionEditor,
  SessionView,
  ThresholdsEditor,
  ThresholdsView,
  UnitEditor,
  UnitView,
} from './settings/editors.jsx';
import { UnlockPanel } from './settings/UnlockPanel.jsx';

/**
 * The view and editor for each section; a section without an entry is not shown yet.
 * @type {!Object<string, {View: function(!Object): !preact.VNode, Editor: function(!Object): !preact.VNode}>}
 */
const EDITORS = {
  unit: { View: UnitView, Editor: UnitEditor },
  calendar: { View: CalendarView, Editor: CalendarEditor },
  thresholds: { View: ThresholdsView, Editor: ThresholdsEditor },
  session: { View: SessionView, Editor: SessionEditor },
};

/** @type {!Array<{name: string, label: string}>} The two tabs. */
const TIERS = [
  { name: 'basic', label: 'Basic' },
  { name: 'advanced', label: 'Advanced' },
];

/**
 * Section names whose empty-state note the Calendar card already shows, so the Data Quality
 * panel below must not repeat it.
 * @type {!Array<string>}
 */
const CALENDAR_NOTE_KEYS = ['Public Holidays', 'Rotations'];

/**
 * The data-quality panel: row counts, tab availability, date spans, and the named
 * findings from `model/quality.js`.
 *
 * Always omits the "no public holidays"/"no rotations" notes, whether or not the viewer can
 * edit: the Basic tab's Calendar card already shows those two empty states, so repeating
 * them here as banners would say the same thing twice on one page.
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

  const optionalTabNotes = Object.entries(quality.optionalTabs).filter(
    ([tab]) => !CALENDAR_NOTE_KEYS.includes(tab)
  );

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
 * The Settings page.
 * @returns {!preact.VNode} The page.
 */
export function Settings() {
  const [tier, setTier] = useState('basic');
  const data = dataset.value;
  if (!data) {
    return null;
  }
  const quality = dataQuality(data);
  const sections = SECTIONS.filter((section) => section.tier === tier && EDITORS[section.name]);
  const calendarIssues = rotationIssues(toRotations(data.rotations));

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Settings</h1>
          <p class="pagehead__sub">What this dashboard is set up for, and how much of the battalion it covers.</p>
        </div>
        <Segmented options={TIERS} value={tier} onChange={setTier} label="Settings tier" radio />
      </header>

      {canEdit.value ? null : <UnlockPanel />}

      {tier === 'advanced' ? (
        <Banner tone="warning">
          These change how the dashboard runs, and in later releases how messages and forms are read. Review each change before saving.
        </Banner>
      ) : null}

      <div class="grid-2">
        {sections.map(({ name, label }) => (
          <SectionCard
            key={name}
            section={name}
            title={label}
            value={data.settings[name]}
            meta={data.settingsMeta[name]}
            View={EDITORS[name].View}
            Editor={EDITORS[name].Editor}
          />
        ))}
      </div>

      {tier === 'basic' && calendarIssues.length > 0 ? (
        <div class="band">
          {calendarIssues.map((issue, index) => (
            <Banner tone={issue.kind === 'invalid' ? 'error' : 'warning'} key={index}>
              {issue.message}
            </Banner>
          ))}
        </div>
      ) : null}

      {tier === 'basic' ? <DataQualityPanel quality={quality} /> : null}
    </div>
  );
}
