/**
 * What this dashboard is set up for. How much of the battalion it covers is on Filing & Accuracy.
 *
 * Every viewer sees every setting; a viewer holding the settings password can also change
 * one, section by section, from the Basic and Advanced tabs below. Each section's card says
 * when it is still the default. Settings are no longer maintained by SQL: holidays and
 * rotations are edited under Settings → Calendar, alongside Unit, Thresholds and Session.
 */

import { useState } from 'preact/hooks';
import { canEdit, dataset } from '../app/state.js';
import { Banner } from '../components/Card.jsx';
import { Segmented } from '../components/Segmented.jsx';
import { rotationIssues, toRotations } from '../../../shared/rotations.js';
import { SECTIONS } from '../../../shared/settings/defaults.js';
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
 * The Settings page.
 * @returns {!preact.VNode} The page.
 */
export function Settings() {
  const [tier, setTier] = useState('basic');
  const data = dataset.value;
  if (!data) {
    return null;
  }
  const sections = SECTIONS.filter((section) => section.tier === tier && EDITORS[section.name]);
  const calendarIssues = rotationIssues(toRotations(data.rotations));

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Settings</h1>
          <p class="pagehead__sub">What this dashboard is set up for.</p>
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

    </div>
  );
}
