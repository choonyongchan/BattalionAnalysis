/**
 * MC / MA: the same shape as Report Sick, over Att C (a category match, never a text
 * search — see `classify.js`) and MA, plus the two things unique to this page: how many
 * long-term MC cases are running, and where soldiers are actually being seen.
 */

import { Bar, ChartCard, Heatmap, Scatter } from '../charts/index.ts';
import { DUTY_CLASS, extractSymptoms, isDuty, MC_MA } from '../model/classify.ts';
import { startsByWeekday } from '../model/episodes.ts';
import { soldierLoad } from '../model/leaderboards.ts';
import { LENGTH_BANDS, lengthBySymptom } from '../model/symptoms.ts';
import { companyIndex } from '../../../shared/domain.ts';
import { fmtInt } from '../format.ts';
import { WEEKDAY_NAMES } from '../../../shared/dates.ts';
import { CategoryPage, EpisodeTiles, useCategory, type CategoryRange } from './shared/category.tsx';
import { DutyTrend } from './shared/trends.tsx';
import { EpisodeLeaderboard, LocationsCard, LongMcCard, SoldierLookup, UnitRankings } from './shared/rankings.tsx';
import { PlatoonHeatmap, ReasonsOverTime, episodeCells } from './shared/grids.tsx';

/**
 * The duty classes this page is about: MC (Att C) and MA together, the same pair the Overview's MC / MA tile
 * counts. Defined in `classify.js` so the two cannot drift.
 */
const DUTY = MC_MA;

/** Which weekday MCs start on, and how many start next to a weekend or a holiday. */
function McStartsCard({ range }: { range: CategoryRange }) {
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

/** Soldiers the days-lost concentration figure names. */
const TOP_SOLDIERS = 10;

/** Every soldier on MC in range as one dot: MCs across, days lost up. */
function McPatternCard({ range }: { range: CategoryRange }) {
  const { entries, totalDays, topDays } = soldierLoad(range.episodes, DUTY_CLASS.ATT_C, TOP_SOLDIERS);
  const points = entries.map((entry) => ({
    x: entry.episodes,
    y: entry.daysLost,
    label: (entry.rank + ' ' + entry.name).trim(),
    group: entry.company,
    slot: companyIndex(entry.company),
  }));
  return (
    <ChartCard
      title="MC Pattern, by Soldier"
      note={
        'The ' + TOP_SOLDIERS + ' soldiers with the most MC days hold ' + fmtInt(topDays) + ' of ' +
        fmtInt(totalDays) + ' days. Right and low: many short MCs. High and left: few long ones.'
      }
      coverage="One dot per soldier, in their company's colour; MCs that started in range."
      empty="No MC started in range."
    >
      <Scatter points={points} xName="MCs" yName="days lost" />
    </ChartCard>
  );
}

/** How long MCs ran, by the symptom the parade state names. */
function McLengthCard({ range }: { range: CategoryRange }) {
  const { rows, cells } = lengthBySymptom(
    range.episodes.filter((episode) => episode.dutyClass === DUTY_CLASS.ATT_C),
    8
  );
  return (
    <ChartCard
      title="MC Length, by Symptom"
      coverage="MCs that started in range, by the symptom in the parade-state reason; the stated day count, else the dates. An MC naming two symptoms counts under each."
      empty="No MC started in range."
    >
      <Heatmap
        rows={rows}
        columns={LENGTH_BANDS.map((band) => band.label)}
        cells={cells}
        rowName="Symptom"
        valueName="MCs"
        showValues
        height={Math.max(160, rows.length * 32 + 60)}
      />
    </ChartCard>
  );
}

/** The MC/MA page. */
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
        rows={episodes.filter((episode) => isDuty(DUTY, episode.dutyClass))}
        dateOf={(episode) => episode.startDate}
        labelsOf={(episode) => (episode.symptoms.length > 0 ? episode.symptoms : extractSymptoms(episode.reasons.join(' ')))}
        range={range}
      />
      <div class="grid-2">
        <McPatternCard range={range} />
        <McLengthCard range={range} />
      </div>
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
