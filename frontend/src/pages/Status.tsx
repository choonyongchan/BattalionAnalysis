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

import { Card, EmptyState } from '../components/Card.tsx';
import { DataTable } from '../components/Table.tsx';
import { fmtDate } from '../format.ts';
import { DUTY_CLASS } from '../model/classify.ts';
import { withinRange } from '../model/dateRange.ts';
import { sftAgainstStatus, toSftSessions } from '../model/sft.ts';
import { activeWithin } from '../model/episodes.ts';
import { bucketsFor } from '../model/statusBuckets.ts';
import { CategoryPage, EpisodeTiles, useCategory, type CategoryRange } from './shared/category.tsx';
import type { Dataset } from '../data/feed.ts';
import { DutyTrend } from './shared/trends.tsx';
import { EpisodeLeaderboard, SoldierLookup, UnitRankings } from './shared/rankings.tsx';
import { PlatoonHeatmap, ReasonsOverTime, episodeCells } from './shared/grids.tsx';

/** The duty class this page is about. */
const DUTY = DUTY_CLASS.STATUS;

/**
 * SFT sessions logged on a day the soldier held a training restriction, for a commander to check: some may be
 * allowed (gym under Excuse RMJ), some are a safety question.
 */
function SftStatusCard({ data, range }: { data: Dataset; range: CategoryRange }) {
  const records = useMemo(
    () => toSftSessions(data.sft).filter((record) => withinRange(record.date, range.from, range.to)),
    [data.sft, range.from, range.to]
  );
  const lines = useMemo(() => sftAgainstStatus(records, data.personnel), [records, data.personnel]);
  return (
    <Card
      title="SFT While Restricted"
      note="SFT logged on a day the soldier held Light Duty or an excuse that limits training; names matched loosely, so check each"
    >
      {lines.length === 0 ? (
        <EmptyState>No SFT in range clashes with a training restriction.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'day', label: 'Date' },
            { key: 'who', label: 'Name' },
            { key: 'company', label: 'Company' },
            { key: 'exercises', label: 'Exercises' },
            { key: 'restrictions', label: 'Restriction' },
          ]}
          rows={lines.map((line) => ({ ...line, day: fmtDate(line.date), who: (line.rank + ' ' + line.name).trim() }))}
          rowKey={(line) => line.date + line.name}
        />
      )}
    </Card>
  );
}

/** The Status page. */
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
        rows={episodes.filter((episode) => episode.dutyClass === DUTY)}
        dateOf={(episode) => episode.startDate}
        labelsOf={(episode) => episode.reasons.flatMap(bucketsFor)}
        range={range}
      />
      <SftStatusCard data={data} range={range} />
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
