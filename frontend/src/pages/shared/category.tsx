/**
 * The sections Report Sick, MC/MA and Status are built from.
 *
 * The three pages ask the same four questions — is it trending, which company, which
 * platoon, who most often — so they share these sections rather than each drawing its own.
 * Each page lists the sections it shows, in order; there are no on/off flags to decode.
 *
 * `useCategory` supplies what every section reads: the company-scoped data and the active
 * date range. Every section that is range-bound takes that `range`, so none of them can
 * outlive the range control.
 *
 * This file composes `model/` functions; it computes nothing of its own that a test
 * elsewhere does not already own.
 */

import { useMemo } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { company, dateFrom, dateTo, loadedData } from '../../app/state.ts';
import { Tile, TileRow } from '../../components/Tile.tsx';
import { PageControls } from '../../components/PageControls.tsx';
import { fmtDate, fmtInt } from '../../format.ts';
import { scopeDataset } from '../../model/scope.ts';
import { holidaysIn, weekendBands, type Band } from '../../model/calendarMarks.ts';
import { buildEpisodes, type Episode } from '../../model/episodes.ts';
import { toSubmissions } from '../../model/formsg.ts';
import { soldierIndex } from '../../model/soldier.ts';
import { datesPresent, episodeCounts, type DutyFilter } from '../../model/metrics.ts';
import type { Holiday } from '../../../../shared/settings/defaults.ts';
import type { Rotation } from '../../../../shared/rotations.ts';

/** The range a category page covers, and what falls in it. */
export interface CategoryRange {
  from: string;
  to: string;
  min: string;
  max: string;
  days: string[];
  weekends: Band[];
  holidays: Holiday[];
  rotations: Rotation[];
  /** Episodes starting in the range. */
  episodes: Episode[];
}
import { eachDay, isoToday, withinRange } from '../../model/dateRange.ts';

/** Everything a category page reads: the company-scoped data and the active date range. */
export function useCategory() {
  const full = loadedData();
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const paradeDates = useMemo(() => datesPresent(full.strength), [full.strength]);
  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const submissions = useMemo(() => toSubmissions(data.formSg), [data.formSg]);
  const index = useMemo(() => soldierIndex(data.personnel, submissions), [data.personnel, submissions]);
  const { holidays, rotations } = data;

  const min = paradeDates[0] || isoToday();
  const max = paradeDates[paradeDates.length - 1] || isoToday();
  const from = dateFrom.value || min;
  const to = dateTo.value || max;
  const range = useMemo<CategoryRange>(
    () => ({
      from,
      to,
      min,
      max,
      days: eachDay(from, to),
      weekends: weekendBands(from, to),
      holidays: holidaysIn(holidays, from, to),
      rotations,
      episodes: episodes.filter((episode) => episode.startDate && withinRange(episode.startDate, from, to)),
    }),
    [from, to, min, max, holidays, rotations, episodes]
  );

  return { data, episodes, submissions, index, range };
}

/** The page title, the range it covers, and the company + date bar. */
export function CategoryPage({
  title,
  range,
  children,
}: {
  title: string;
  range: Pick<CategoryRange, 'from' | 'to' | 'min' | 'max'>;
  children: ComponentChildren;
}) {
  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">{title}</h1>
          <p class="pagehead__sub">{fmtDate(range.from)} – {fmtDate(range.to)}</p>
        </div>
      </header>
      <PageControls min={range.min} max={range.max} />
      {children}
    </div>
  );
}

/** Episodes, soldiers and episodes per soldier for one duty class, over the range. */
export function EpisodeTiles({
  range,
  dutyClass,
  labels = {},
}: {
  range: CategoryRange;
  dutyClass: DutyFilter;
  /** Tile labels; `episodes: null` hides that tile. */
  labels?: { episodes?: string | null; soldiers?: string; perSoldier?: string };
}) {
  const { total } = episodeCounts(range.episodes, dutyClass);
  return (
    <TileRow>
      {labels.episodes === null ? null : (
        <Tile label={labels.episodes || 'Episodes'} value={fmtInt(total.episodes)} />
      )}
      <Tile label={labels.soldiers || 'Soldiers'} value={fmtInt(total.soldiers)} />
      <Tile
        label={labels.perSoldier || 'Episodes per soldier'}
        value={total.perSoldier === null ? '—' : total.perSoldier.toFixed(1)}
      />
    </TileRow>
  );
}
