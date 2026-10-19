/**
 * What this dashboard is set up for. How much of the battalion it covers is on Filing & Accuracy.
 *
 * Every viewer sees every setting; a viewer holding the settings password can also change
 * one, section by section, from the Basic and Advanced tabs below. Each section's card says
 * when it is still the default. Settings are no longer maintained by SQL: holidays and
 * rotations are edited under Settings → Calendar, alongside Unit, Thresholds and Session.
 */

import { useState } from 'preact/hooks';
import { canEdit, loadedData } from '../app/state.ts';
import type { Dataset } from '../data/feed.ts';
import { Banner } from '../components/Card.tsx';
import { Segmented } from '../components/Segmented.tsx';
import { rotationIssues } from '../../../shared/rotations.ts';
import { SECTIONS, type SectionName } from '../../../shared/settings/defaults.ts';
import type { ComponentType } from 'preact';
import type { EditorProps, ViewProps } from './settings/editors.tsx';
import { SectionCard } from './settings/SectionCard.tsx';
import {
  CalendarEditor,
  CalendarView,
  SessionEditor,
  SessionView,
  ThresholdsEditor,
  ThresholdsView,
  UnitEditor,
  UnitView,
} from './settings/editors.tsx';
import { UnlockPanel } from './settings/UnlockPanel.tsx';

/** The view and editor for each section; a section without an entry is not shown yet. */
const EDITORS: { [S in SectionName]: { View: ComponentType<ViewProps<S>>; Editor: ComponentType<EditorProps<S>> } } = {
  unit: { View: UnitView, Editor: UnitEditor },
  calendar: { View: CalendarView, Editor: CalendarEditor },
  thresholds: { View: ThresholdsView, Editor: ThresholdsEditor },
  session: { View: SessionView, Editor: SessionEditor },
};

/** The two tabs. */
const TIERS = [
  { name: 'basic', label: 'Basic' },
  { name: 'advanced', label: 'Advanced' },
] as const;

/** One section's card, with that section's view and editor. */
function sectionCard<S extends SectionName>(name: S, label: string, data: Dataset) {
  const { View, Editor } = EDITORS[name];
  return <SectionCard key={name} section={name} title={label} value={data.settings[name]} meta={data.settingsMeta[name]} View={View} Editor={Editor} />;
}

/** The Settings page. */
export function Settings() {
  const [tier, setTier] = useState<'basic' | 'advanced'>('basic');
  const data = loadedData();
  const sections = SECTIONS.filter((section) => section.tier === tier);
  const calendarIssues = rotationIssues(data.rotations);

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
        {sections.map(({ name, label }) => sectionCard(name, label, data))}
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
