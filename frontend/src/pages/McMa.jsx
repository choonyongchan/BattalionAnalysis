/**
 * MC / MA: the same shape as Report Sick, over Att C (a category match, never a text
 * search — see `classify.js`) and MA, plus the two things unique to this page: how many
 * long-term MC cases are running, and where soldiers are actually being seen.
 */

import { Bar, ChartCard } from '../charts/index.js';
import { DUTY_CLASS, extractSymptoms, isDuty, MC_MA } from '../model/classify.js';
import { startsByWeekday } from '../model/episodes.js';
import { fmtInt } from '../format.js';
import { WEEKDAY_NAMES } from '../../../shared/dates.js';
import { CategoryPage, EpisodeTiles, useCategory } from './shared/category.jsx';
import { DutyTrend } from './shared/trends.jsx';
import { EpisodeLeaderboard, LocationsCard, LongMcCard, SoldierLookup, UnitRankings } from './shared/rankings.jsx';
import { PlatoonHeatmap, ReasonsOverTime, episodeCells } from './shared/grids.jsx';

/**
 * The duty classes this page is about: MC (Att C) and MA together, the same pair the
 * Overview's MC / MA tile counts. Defined in `classify.js` so the two cannot drift.
 * @type {!Array<string>}
 */
const DUTY = MC_MA;

/**
 * Which weekday MCs start on, and how many start next to a weekend or a holiday.
 * @param {{range: !Object}} props The range from `useCategory`.
 * @returns {!preact.VNode} The card.
 */
function McStartsCard({ range }) {
  const { counts, nextToBreak, total } = startsByWeekday(range.episodes, DUTY_CLASS.ATT_C, range.holidays);
  return (
    <ChartCard
      title="When MCs Start"
      note={
        fmtInt(nextToBreak) + ' of ' + fmtInt(total) +
        ' MCs started on a Monday, a Friday or beside a public holiday; about 2 in 7 would by chance.'
      }
      empty="No MC started in range."
    >
      <Bar categories={WEEKDAY_NAMES} values={counts} valueName="MCs started" horizontal={false} />
    </ChartCard>
  );
}

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
      <McStartsCard range={range} />
      <LocationsCard personnel={data.personnel} range={range} />
      <LongMcCard episodes={episodes} range={range} />
      <EpisodeLeaderboard range={range} dutyClass={DUTY} metric="days" />
      <UnitRankings
        range={range}
        dutyClass={DUTY}
        labels={{ count: 'Number of MC/MA', soldiers: 'Unique Personnel on MC/MA' }}
      />
      <SoldierLookup index={index} episodes={episodes} dutyClass={DUTY} />
    </CategoryPage>
  );
}
