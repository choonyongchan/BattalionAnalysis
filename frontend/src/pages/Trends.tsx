/**
 * Trends over the range: strength, report sick from both sources, MC/MA, Status, and the report-sick flow.
 * Every chart follows the company and date controls.
 */

import { useMemo } from 'preact/hooks';
import { ChartCard, Line, Sankey } from '../charts/index.ts';
import { fmtInt } from '../format.ts';
import { DUTY_CLASS, MC_MA } from '../model/classify.ts';
import type { Episode } from '../model/episodes.ts';
import type { Submission } from '../model/formsg.ts';
import type { DutyFilter } from '../model/metrics.ts';
import type { Scope } from '../components/Segmented.tsx';
import type { Dataset } from '../data/feed.ts';
import { submissionTrend } from '../model/formsg.ts';
import { reportSickFlow } from '../model/sankey.ts';
import { dutyTrend, presentTrend } from '../model/strength.ts';
import { CategoryPage, useCategory, type CategoryRange } from './shared/category.tsx';
import { TrendSection } from './shared/trends.tsx';

/** Session every trend describes. */
const SESSION = 'FPS';

/** The note under each soldier-count trend. */
const TREND_COVERAGE = 'Count of soldiers on each parade; a day with no parade state reads zero.';

/** Report sick from both sources on one chart: the parade state's count and FormSG's. */
function SickSourcesCard({ data, submissions, range }: { data: Dataset; submissions: Submission[]; range: CategoryRange }) {
  const options = { scope: 'battalion', session: SESSION, asRate: false };
  const parade = dutyTrend(data.personnel, data.strength, DUTY_CLASS.REPORT_SICK, range.days, options);
  const formsg = submissionTrend(submissions, data.strength, range.days, options);
  return (
    <ChartCard
      title="Reporting Sick: Parade State and FormSG"
      coverage="Parade state counts soldiers listed as reporting sick; FormSG counts submissions. A day with no filing reads zero."
    >
      <Line
        categories={range.days}
        series={[
          { name: 'Parade state', values: parade.series[0]?.values ?? [], neutral: true },
          { name: 'FormSG', values: formsg.series[0]?.values ?? [], accent: true },
        ]}
        weekends={range.weekends}
        holidays={range.holidays}
        valueName="soldiers"
      />
    </ChartCard>
  );
}

/** The report-sick Sankey, with its coverage findings printed under it. */
function SankeyCard({ episodes, submissions, from, to }: { episodes: Episode[]; submissions: Submission[]; from: string; to: string }) {
  const flow = useMemo(
    () => reportSickFlow({ episodes, submissions, from, to }),
    [episodes, submissions, from, to]
  );
  const counts = flow.coverage;
  return (
    <ChartCard
      title="Report-Sick Flow"
      note="Parade state to FormSG is counts only, not matched by name; type, outcome and Status follow each FormSG submission."
      coverage={
        `${fmtInt(counts.reportingSick)} reporting sick on the parade state, ${fmtInt(counts.reportedSick)} reported sick on FormSG. ` +
        `Of those, the form records ${fmtInt(counts.mc)} MC, ${fmtInt(counts.status)} Status, ${fmtInt(counts.both)} both and ${fmtInt(counts.none)} no outcome.`
      }
    >
      <Sankey nodes={flow.nodes} links={flow.links} />
    </ChartCard>
  );
}

/** The Trends page. */
export function Trends() {
  const { data, episodes, submissions, range } = useCategory();
  const dutyTrendFn = (dutyClass: DutyFilter) => (scope: Scope, days: string[]) =>
    dutyTrend(data.personnel, data.strength, dutyClass, days, { scope, session: SESSION, asRate: false });

  return (
    <CategoryPage title="Trends" range={range}>
      <div class="grid-2">
        <TrendSection
          title="Soldiers Present"
          coverage="Present strength on each parade; a day with no parade state reads zero."
          range={range}
          trendFn={(scope, days) => presentTrend(data.strength, days, { scope, session: SESSION })}
        />
        <SickSourcesCard data={data} submissions={submissions} range={range} />
        <TrendSection title="MC / MA" coverage={TREND_COVERAGE} range={range} trendFn={dutyTrendFn(MC_MA)} />
        <TrendSection title="Status" coverage={TREND_COVERAGE} range={range} trendFn={dutyTrendFn(DUTY_CLASS.STATUS)} />
      </div>
      <SankeyCard episodes={episodes} submissions={submissions} from={range.from} to={range.to} />
    </CategoryPage>
  );
}
