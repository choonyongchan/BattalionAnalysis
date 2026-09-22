/**
 * MC / MA: the same shape as Report Sick, over Att C (a category match, never a text
 * search — see `classify.js`) and MA, plus the two things unique to this page: how many
 * long-term MC cases are running, and where soldiers are actually being seen.
 */

import { DUTY_CLASS, extractSymptoms } from '../model/classify.js';
import {
  CategoryPage,
  DutyTrend,
  EpisodeLeaderboard,
  EpisodeTiles,
  LocationsCard,
  LongMcCard,
  PlatoonHeatmap,
  ReasonsOverTime,
  SoldierLookup,
  UnitRankings,
  episodeCells,
  useCategory,
} from './shared/category.jsx';

/** @type {string} The duty class this page is about. */
const DUTY = DUTY_CLASS.ATT_C;

/**
 * The MC/MA page.
 * @returns {!preact.VNode} The page.
 */
export function McMa() {
  const { data, episodes, index, range } = useCategory();

  return (
    <CategoryPage title="MC / MA" range={range}>
      <EpisodeTiles range={range} dutyClass={DUTY} />
      <DutyTrend title="MC / MA Trend" data={data} dutyClass={DUTY} range={range} />
      <PlatoonHeatmap cells={episodeCells(range.episodes, DUTY)} />
      <ReasonsOverTime
        rows={episodes.filter((e) => e.dutyClass === DUTY)}
        dateOf={(e) => e.startDate}
        labelsOf={(e) => (e.symptoms.length > 0 ? e.symptoms : extractSymptoms(e.reasons.join(' ')))}
        range={range}
      />
      <LocationsCard personnel={data.personnel} />
      <LongMcCard episodes={episodes} range={range} />
      <EpisodeLeaderboard range={range} dutyClass={DUTY} metric="days" />
      <UnitRankings data={data} dutyClass={DUTY} />
      <SoldierLookup index={index} episodes={episodes} dutyClass={DUTY} />
    </CategoryPage>
  );
}
