/**
 * MC / MA: the same shape as Report Sick, over Att C (a category match, never a text
 * search — see `classify.js`) and MA, plus the two things unique to this page: how many
 * long-term MC cases are running, and where soldiers are actually being seen.
 */

import { extractSymptoms, isDuty, MC_MA } from '../model/classify.js';
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

/**
 * The duty classes this page is about: MC (Att C) and MA together, the same pair the
 * Overview's MC / MA tile counts. Defined in `classify.js` so the two cannot drift.
 * @type {!Array<string>}
 */
const DUTY = MC_MA;

/**
 * The MC/MA page.
 * @returns {!preact.VNode} The page.
 */
export function McMa() {
  const { data, episodes, index, range } = useCategory();

  return (
    <CategoryPage title="MC / MA" range={range}>
      <EpisodeTiles
        range={range}
        dutyClass={DUTY}
        labels={{
          episodes: 'Number of MC/MA taken',
          perSoldier: 'Average number of MC/MA taken per soldier',
        }}
      />
      <DutyTrend title="MC / MA Trend" data={data} dutyClass={DUTY} range={range} />
      <PlatoonHeatmap cells={episodeCells(range.episodes, DUTY)} />
      <ReasonsOverTime
        rows={episodes.filter((e) => isDuty(DUTY, e.dutyClass))}
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
