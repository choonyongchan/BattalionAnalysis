/**
 * How the battalion has moved over the range: strength, report sick from both sources,
 * MC/MA, Status, and how report sick flows from the parade state through FormSG.
 *
 * Moved off the Today page so that page answers only "what is the battalion today". Every
 * chart here follows the company and date-range controls.
 */

import { useMemo } from 'preact/hooks';
import { ChartCard, Line, Sankey } from '../charts/index.js';
import { fmtInt } from '../format.js';
import { DUTY_CLASS, MC_MA } from '../model/classify.js';
import { submissionTrend } from '../model/formsg.js';
import { reportSickFlow } from '../model/sankey.js';
import { dutyTrend, presentTrend } from '../model/strength.js';
import { CategoryPage, useCategory } from './shared/category.jsx';
import { TrendSection } from './shared/trends.jsx';

/** @type {string} Session every trend describes. */
const SESSION = 'FPS';

/** @type {string} The note under each soldier-count trend. */
const TREND_COVERAGE = 'Count of soldiers on each parade; a day with no parade state reads zero.';

/**
 * Report sick from both sources on one chart: the parade state's count and FormSG's.
 *
 * They measure the same event recorded by different people, so the useful reading is the
 * gap between them. Always the battalion (or the one company picked in the page bar); the
 * per-company view lives on the Report Sick page.
 * @param {{data: !Object, submissions: Array<!Object>, range: !Object}} props The scoped
 *     dataset, its FormSG submissions, and the trend range.
 * @returns {!preact.VNode} The card.
 */
function SickSourcesCard({ data, submissions, range }) {
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
          { name: 'Parade state', values: parade.series[0]?.values || [], neutral: true },
          { name: 'FormSG', values: formsg.series[0]?.values || [], accent: true },
        ]}
        weekends={range.weekends}
        holidays={range.holidays}
        valueName="soldiers"
      />
    </ChartCard>
  );
}

/**
 * The report-sick Sankey, with its coverage findings printed under it.
 * @param {{episodes: Array<!Object>, submissions: Array<!Object>, from: string, to:
 *     string}} props Inputs to `reportSickFlow`.
 * @returns {!preact.VNode} The card.
 */
function SankeyCard({ episodes, submissions, from, to }) {
  const flow = useMemo(
    () => reportSickFlow({ episodes, submissions, from, to }),
    [episodes, submissions, from, to]
  );
  const c = flow.coverage;
  return (
    <ChartCard
      title="Report-Sick Flow"
      note="Parade state to FormSG is counts only, not matched by name; type, outcome and Status follow each FormSG submission."
      coverage={
        fmtInt(c.reportingSick) + ' reporting sick on the parade state, ' + fmtInt(c.reportedSick) +
        ' reported sick on FormSG. Of those, the form records ' + fmtInt(c.mc) + ' MC, ' + fmtInt(c.status) +
        ' Status, ' + fmtInt(c.both) + ' both and ' + fmtInt(c.none) + ' no outcome.'
      }
    >
      <Sankey nodes={flow.nodes} links={flow.links} />
    </ChartCard>
  );
}

/**
 * The Trends page.
 * @returns {!preact.VNode} The page.
 */
export function Trends() {
  const { data, episodes, submissions, range } = useCategory();
  const dutyTrendFn = (dutyClass) => (scope, days) =>
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
