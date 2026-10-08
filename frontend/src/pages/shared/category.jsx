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
import { company, dataset, dateFrom, dateTo } from '../../app/state.js';
import { Tile, TileRow } from '../../components/Tile.jsx';
import { PageControls } from '../../components/PageControls.jsx';
import { fmtDate, fmtInt } from '../../format.js';
import { scopeDataset, scopeSubmissions } from '../../model/scope.js';
import { toHolidays, holidaysIn, weekendBands } from '../../model/calendarMarks.js';
import { toRotations } from '../../../../shared/rotations.js';
import { buildEpisodes } from '../../model/episodes.js';
import { toSubmissions } from '../../model/formsg.js';
import { soldierIndex } from '../../model/soldier.js';
import { datesPresent, episodeCounts } from '../../model/metrics.js';
import { eachDay, isoToday, withinRange } from '../../model/dateRange.js';

/**
 * Everything a category page reads: the company-scoped data and the active date range.
 *
 * The range bounds come from the full, unscoped parade dates so the picker and trend axis
 * do not contract when a company that filed on fewer days is picked.
 * @returns {{data: !Object, episodes: Array<!Object>, submissions: Array<!Object>,
 *     index: !Object, range: {from: string, to: string, min: string, max: string,
 *     days: string[], weekends: Array<!Object>, holidays: Array<!Object>,
 *     rotations: Array<!Object>, episodes: Array<!Object>}}} The scoped data, its soldier
 *     index, and the range with its trend days, annotations and in-range episodes.
 */
export function useCategory() {
  const full = dataset.value;
  const data = useMemo(() => scopeDataset(full, company.value), [full, company.value]);
  const paradeDates = useMemo(() => datesPresent(full.strength), [full.strength]);
  const episodes = useMemo(() => buildEpisodes(data.personnel), [data.personnel]);
  const submissions = useMemo(
    () => scopeSubmissions(toSubmissions(data.formSg), company.value),
    [data.formSg, company.value]
  );
  const index = useMemo(() => soldierIndex(data.personnel, submissions), [data.personnel, submissions]);
  const holidays = useMemo(() => toHolidays(data.holidays), [data.holidays]);
  const rotations = useMemo(() => toRotations(data.rotations), [data.rotations]);

  const min = paradeDates[0] || isoToday();
  const max = paradeDates[paradeDates.length - 1] || isoToday();
  const from = dateFrom.value || min;
  const to = dateTo.value || max;
  const range = useMemo(
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

/**
 * The page title, the range it covers, and the company + date bar.
 * @param {{title: string, range: !Object, children: *}} props The title, the range from
 *     `useCategory`, and the page's sections.
 * @returns {!preact.VNode} The page.
 */
export function CategoryPage({ title, range, children }) {
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

/**
 * Episodes, soldiers and episodes per soldier for one duty class, over the range.
 * @param {{range: !Object, dutyClass: (string|!Array<string>), labels?: {episodes?: string,
 *     soldiers?: string, perSoldier?: string}}} props The range, the duty class, and
 *     optional tile labels; `labels.episodes: null` leaves the episode-count tile out.
 * @returns {!preact.VNode} The tile row.
 */
export function EpisodeTiles({ range, dutyClass, labels = {} }) {
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
