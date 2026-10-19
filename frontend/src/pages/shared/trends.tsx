/**
 * Trend cards for the category pages: a Battalion/Companies line chart per duty class.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { company } from '../../app/state.ts';
import { Segmented, SCOPE_OPTIONS, type Scope } from '../../components/Segmented.tsx';
import { ChartCard, Line } from '../../charts/index.ts';
import { companyIndex, isCompany } from '../../../../shared/domain.ts';
import { dutyTrend, type GappyTrend } from '../../model/strength.ts';
import type { DutyFilter } from '../../model/metrics.ts';
import type { Dataset } from '../../data/feed.ts';
import type { CategoryRange } from './category.tsx';

/** The range fields a trend card reads. */
type TrendRange = Pick<CategoryRange, 'days' | 'weekends' | 'holidays'>;

/** One trend card: a Battalion/Companies toggle over a Line chart. */
export function TrendSection({
  title,
  coverage,
  trendFn,
  range,
  controls,
  valueName = 'soldiers',
}: {
  title: string;
  coverage: string;
  /** The series for a scope over the range's days. */
  trendFn: (scope: Scope, dates: string[]) => GappyTrend;
  range: TrendRange;
  controls?: ComponentChildren;
  valueName?: string;
}) {
  const scopedCompany = isCompany(company.value) ? company.value : null;
  const [scope, setScope] = useState<Scope>('battalion');
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
          slot: scopedCompany ? companyIndex(scopedCompany) : effectiveScope === 'companies' ? companyIndex(series.name) : undefined,
          neutral: !scopedCompany && effectiveScope === 'battalion',
        }))}
        weekends={range.weekends}
        holidays={range.holidays}
        valueName={valueName}
      />
    </ChartCard>
  );
}

/** The parade-state count trend of one duty class. */
export function DutyTrend({ title, data, dutyClass, range }: { title: string; data: Dataset; dutyClass: DutyFilter; range: TrendRange }) {
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
