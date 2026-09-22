/**
 * Status: the same shape as Report Sick and MC/MA, over the 10 normalised buckets
 * `statusBuckets.js` folds 403 free-text reasons into. Status is present-but-restricted,
 * never absence — the trend reads it as a rate the same way it reads MC, which is a rate
 * of restriction, not a rate of loss.
 */

import { DUTY_CLASS } from '../model/classify.js';
import { bucketsFor } from '../model/statusBuckets.js';
import {
  CategoryPage,
  DutyTrend,
  EpisodeLeaderboard,
  EpisodeTiles,
  PlatoonHeatmap,
  ReasonsOverTime,
  SoldierLookup,
  UnitRankings,
  episodeCells,
  useCategory,
} from './shared/category.jsx';

/** @type {string} The duty class this page is about. */
const DUTY = DUTY_CLASS.STATUS;

/**
 * The Status page.
 * @returns {!preact.VNode} The page.
 */
export function Status() {
  const { data, episodes, index, range } = useCategory();

  return (
    <CategoryPage title="Status" range={range}>
      <EpisodeTiles range={range} dutyClass={DUTY} />
      <DutyTrend title="Status Trend" data={data} dutyClass={DUTY} range={range} />
      <PlatoonHeatmap cells={episodeCells(range.episodes, DUTY)} />
      <ReasonsOverTime
        rows={episodes.filter((e) => e.dutyClass === DUTY)}
        dateOf={(e) => e.startDate}
        labelsOf={(e) => e.reasons.flatMap(bucketsFor)}
        range={range}
      />
      <EpisodeLeaderboard range={range} dutyClass={DUTY} metric="status" />
      <UnitRankings data={data} dutyClass={DUTY} />
      <SoldierLookup index={index} episodes={episodes} dutyClass={DUTY} />
    </CategoryPage>
  );
}
