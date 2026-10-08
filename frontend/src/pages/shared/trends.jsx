/**
 * Trend cards for the category pages: a Battalion/Companies line chart per duty class.
 */

import { useState } from 'preact/hooks';
import { company } from '../../app/state.js';
import { Segmented, SCOPE_OPTIONS } from '../../components/Segmented.jsx';
import { ChartCard, Line } from '../../charts/index.js';
import { COMPANIES } from '../../../../shared/domain.js';
import { ALL_COMPANIES } from '../../model/scope.js';
import { dutyTrend } from '../../model/strength.js';

/**
 * One trend card: a Battalion/Companies toggle over a Line chart.
 *
 * A real component rather than a helper called as a function, so its `useState` for the
 * scope toggle owns a hook slot of its own. With a single company selected in the page
 * bar the toggle has nothing to switch between, so it is hidden and the chart draws that
 * company's one line in its own colour slot.
 * @param {{title: string, coverage: string, trendFn: function(string, string[]): !Object,
 *     range: !Object, controls?: *, valueName?: string}} props The card's title and
 *     coverage line; `trendFn(scope, dates)` returns `{dates, series}`; the range supplies
 *     the dates and annotations; `controls` is any card-own filter, drawn beside the scope
 *     toggle; `valueName` names the axis unit.
 * @returns {!preact.VNode} The card.
 */
export function TrendSection({ title, coverage, trendFn, range, controls, valueName = 'soldiers' }) {
  const scopedCompany = company.value !== ALL_COMPANIES ? company.value : null;
  const [scope, setScope] = useState('battalion');
  const effectiveScope = scopedCompany ? 'battalion' : scope;
  const trend = trendFn(effectiveScope, range.days);

  return (
    <ChartCard
      title={title}
      coverage={coverage}
      controls={
        <>
          {scopedCompany ? null : (
            <Segmented options={SCOPE_OPTIONS} value={scope} onChange={setScope} label={title + ': scope'} />
          )}
          {controls}
        </>
      }
    >
      <Line
        categories={trend.dates}
        series={trend.series.map((series) => ({
          ...series,
          name: scopedCompany || series.name,
          slot: scopedCompany
            ? COMPANIES.indexOf(scopedCompany)
            : effectiveScope === 'companies'
              ? COMPANIES.indexOf(series.name)
              : undefined,
          neutral: !scopedCompany && effectiveScope === 'battalion',
        }))}
        weekends={range.weekends}
        holidays={range.holidays}
        valueName={valueName}
      />
    </ChartCard>
  );
}

/**
 * The parade-state count trend of one duty class.
 * @param {{title: string, data: !Object, dutyClass: (string|!Array<string>), range: !Object}} props The
 *     card title, the scoped dataset, the duty class, and the range.
 * @returns {!preact.VNode} The card.
 */
export function DutyTrend({ title, data, dutyClass, range }) {
  return (
    <TrendSection
      title={title}
      coverage="Count of soldiers; a day with no parade-state coverage is reported as zero."
      trendFn={(scope, dates) =>
        dutyTrend(data.personnel, data.strength, dutyClass, dates, {
          scope,
          session: 'FPS',
          asRate: false,
        })
      }
      range={range}
    />
  );
}
