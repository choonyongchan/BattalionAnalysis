/**
 * MC / MA: the same shape as Report Sick, over Att C (a category match, never a text
 * search — see `classify.js`) and MA, plus the two things unique to this page: how many
 * long-term MC cases are running, and where soldiers are actually being seen.
 */

import { useMemo } from 'preact/hooks';
import { company, dataset } from '../app/state.js';
import { DUTY_CLASS, extractSymptoms } from '../model/classify.js';
import { buildEpisodes } from '../model/episodes.js';
import { toSubmissions } from '../model/formsg.js';
import { datesPresent } from '../model/metrics.js';
import { scopeDataset, scopeSubmissions } from '../model/scope.js';
import { soldierIndex } from '../model/soldier.js';
import { CategoryPage } from './shared/CategoryPage.jsx';

/**
 * The MC/MA page.
 * @returns {!preact.VNode} The page.
 */
export function McMa() {
  const full = dataset.value;
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const calendarDates = useMemo(() => datesPresent(full.strength), [full.strength]);
  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const submissions = useMemo(
    () => scopeSubmissions(toSubmissions(data.formSg), company.value),
    [data.formSg, company.value]
  );
  const index = useMemo(() => soldierIndex(data.personnel, submissions), [data.personnel, submissions]);

  const mcEpisodes = useMemo(() => episodes.filter((e) => e.dutyClass === DUTY_CLASS.ATT_C), [episodes]);
  const reasonSource = useMemo(
    () => ({
      rows: mcEpisodes,
      dateOf: (e) => e.startDate,
      labelsOf: (e) => (e.symptoms.length > 0 ? e.symptoms : extractSymptoms(e.reasons.join(' '))),
    }),
    [mcEpisodes]
  );

  return (
    <CategoryPage
      title="MC / MA"
      dataset={data}
      calendarDates={calendarDates}
      episodes={episodes}
      dutyClass={DUTY_CLASS.ATT_C}
      leaderboardMetric="days"
      reasonSource={reasonSource}
      showHeatmap
      showLocations
      showLongMc
      soldierIndex={index}
    />
  );
}
