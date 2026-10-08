/**
 * Status: the same shape as Report Sick and MC/MA, over the 10 normalised buckets
 * `statusBuckets.js` folds 403 free-text reasons into. Status is present-but-restricted,
 * never absence — the trend reads it as a rate the same way it reads MC, which is a rate
 * of restriction, not a rate of loss.
 *
 * Unlike the other medical pages, the range sections count every Status in force during
 * the range, not only those begun in it: a status runs for weeks, so a start-date filter
 * would drop most of the soldiers the trend shows on the same days.
 */

import { useMemo } from 'preact/hooks';

import { DUTY_CLASS } from '../model/classify.js';
import { activeWithin } from '../model/episodes.js';
import { bucketsFor } from '../model/statusBuckets.js';
import { CategoryPage, EpisodeTiles, useCategory } from './shared/category.jsx';
import { DutyTrend } from './shared/trends.jsx';
import { EpisodeLeaderboard, SoldierLookup, UnitRankings } from './shared/rankings.jsx';
import { PlatoonHeatmap, ReasonsOverTime, episodeCells } from './shared/grids.jsx';

/** @type {string} The duty class this page is about. */
const DUTY = DUTY_CLASS.STATUS;

/**
 * The Status page.
 * @returns {!preact.VNode} The page.
 */
export function Status() {
  const { data, episodes, index, range } = useCategory();
  const inForce = useMemo(
    () => ({ ...range, episodes: episodes.filter((episode) => activeWithin(episode, range.from, range.to)) }),
    [range, episodes]
  );

  return (
    <CategoryPage title="Status & Restrictions" range={range}>
      <EpisodeTiles
        range={inForce}
        dutyClass={DUTY}
        labels={{
          episodes: 'Number of Status in force',
          perSoldier: 'Average number of Status taken per soldier',
        }}
      />
      <DutyTrend title="Status Trend" data={data} dutyClass={DUTY} range={range} />
      <PlatoonHeatmap cells={episodeCells(inForce.episodes, DUTY)} />
      <ReasonsOverTime
        rows={episodes.filter((e) => e.dutyClass === DUTY)}
        dateOf={(e) => e.startDate}
        labelsOf={(e) => e.reasons.flatMap(bucketsFor)}
        range={range}
      />
      <EpisodeLeaderboard range={inForce} dutyClass={DUTY} metric="status" />
      <UnitRankings
        range={inForce}
        dutyClass={DUTY}
        labels={{ count: 'Number of Status', soldiers: 'Unique Personnel on Status' }}
      />
      <SoldierLookup index={index} episodes={episodes} dutyClass={DUTY} />
    </CategoryPage>
  );
}
