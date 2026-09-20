/**
 * ORBAT: who is on duty today, from the CDO down.
 *
 * A single-date view rather than a range — the question this page answers is "who is in
 * the chair right now", not a trend. The company comes from the page-wide selector in the
 * bar at the top; coverage in the real data is poor enough that the choice matters:
 * Archer and Stallion file a roster most days, Hercules files only COS, Cougar files
 * almost nothing, and Braves and Scorpion file none at all, ever. The battalion-level
 * tree (40 SAR) shows all six regardless, because a company that filed nothing is the
 * finding, not a reason to hide it.
 */

import { useMemo, useState } from 'preact/hooks';
import { company, dataset } from '../app/state.js';
import { Card, Coverage, EmptyState } from '../components/Card.jsx';
import { PageControls } from '../components/PageControls.jsx';
import { ChartCard, Tree } from '../charts/index.js';
import { COMPANIES } from '../model/domain.js';
import { ALL_COMPANIES } from '../model/scope.js';
import { datesPresent } from '../model/metrics.js';
import { orbatCoverage, orbatTree } from '../model/orbat.js';
import { fmtDate, fmtFraction } from '../format.js';

/**
 * The ORBAT page.
 * @returns {!preact.VNode} The page.
 */
export function Orbat() {
  const data = dataset.value;
  const paradeDates = useMemo(() => datesPresent(data.strength), [data.strength]);
  const [date, setDate] = useState(paradeDates[paradeDates.length - 1] || null);
  const whole = company.value === ALL_COMPANIES;

  if (!date) {
    return (
      <div class="page">
        <header class="pagehead">
          <h1 class="pagehead__title">Order of Battle</h1>
        </header>
        <EmptyState>No parade state has been read yet.</EmptyState>
      </div>
    );
  }

  const tree = orbatTree(data.roster, date, whole ? undefined : { company: company.value });
  const coverage = orbatCoverage(data.roster, date);

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Order of Battle</h1>
          <p class="pagehead__sub">Who is on duty, from the CDO down.</p>
        </div>
      </header>

      <PageControls
        min={paradeDates[0] || date}
        max={paradeDates[paradeDates.length - 1] || date}
        showRange={false}
      />

      <div class="controlrow">
        <label class="control">
          <span class="field__label">Date</span>
          <select class="field" value={date} onChange={(event) => setDate(event.currentTarget.value)}>
            {paradeDates
              .slice()
              .reverse()
              .map((d) => (
                <option key={d} value={d}>
                  {fmtDate(d)}
                </option>
              ))}
          </select>
        </label>
      </div>

      <Card title={whole ? '40 SAR' : company.value}>
        <ChartCard title="">
          <Tree tree={tree} height={whole ? 620 : 340} />
        </ChartCard>
        <Coverage>
          {fmtFraction(coverage.filedCount, COMPANIES.length)} companies filed a roster on {fmtDate(date)}.
        </Coverage>
      </Card>
    </div>
  );
}
