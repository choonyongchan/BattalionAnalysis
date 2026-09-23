/**
 * ORBAT: who is on duty today, from the CDO down.
 *
 * A single-date view rather than a range — the question this page answers is "who is in
 * the chair right now", not a trend. The company comes from the page-wide selector, and
 * the date sits in the same bar beside it.
 *
 * Drawn as a structured roster — one card per company, the chain of command indented
 * beneath its CDO — rather than a node-and-link tree. Every company has the same seven
 * roles in the same shape, so a tree's lines say nothing a reader does not already know,
 * while its nodes squeeze a rank and a forty-character name into a label. Cards read as
 * a list, side by side, and a gap in one company's chain stands out against the others.
 *
 * Coverage in the real data is poor, and the page says so: Archer and Stallion file a
 * roster most days, Hercules files only COS, Cougar files almost nothing, and Braves none
 * at all. The battalion view shows all five regardless, because a company that filed
 * nothing is the finding, not a reason to hide it.
 *
 * A role filed as `-` reads "Vacant" in the warning colour, distinct from one not filed at
 * all, and the coverage line lists every vacant chair — including a named sub-unit's PDS
 * such as Hercules' PDSMED, which the four-platoon tree has no slot for.
 */

import { useMemo, useState } from 'preact/hooks';
import { company, dataset } from '../app/state.js';
import { Card, Coverage, EmptyState } from '../components/Card.jsx';
import { PageControls } from '../components/PageControls.jsx';
import { COMPANIES } from '../model/domain.js';
import { ALL_COMPANIES } from '../model/scope.js';
import { datesPresent } from '../model/metrics.js';
import { orbatCoverage, orbatTree, vacanciesOn } from '../model/orbat.js';
import { fmtDate, fmtFraction } from '../format.js';

/**
 * One role and, indented beneath it, the roles that report to it.
 * @param {{node: !Object}} props A role node from `orbatTree`.
 * @returns {!preact.VNode} The list item.
 */
function RoleItem({ node }) {
  const children = node.children || [];
  return (
    <li class="orbat__item">
      <div class={'orbat__role' + (node.vacant ? ' orbat__role--vacant' : node.filed ? '' : ' orbat__role--unfiled')}>
        <span class="orbat__tag">{node.role}</span>
        <span class="orbat__name">{node.name}</span>
      </div>
      {children.length > 0 ? (
        <ul class="orbat__list">
          {children.map((child) => (
            <RoleItem key={child.role} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * One company's card: its name in the company's colour, then its chain of command.
 * @param {{node: !Object}} props A company node from `orbatTree`.
 * @returns {!preact.VNode} The card.
 */
function CompanyRoster({ node }) {
  const [top] = node.children || [];
  return (
    <section class={'orbat__company orbat__company--' + node.name.toLowerCase()}>
      <h3 class="orbat__heading">{node.name}</h3>
      {node.filed && top ? (
        <ul class="orbat__list orbat__list--root">
          <RoleItem node={top} />
        </ul>
      ) : (
        <p class="orbat__none">No roster filed</p>
      )}
    </section>
  );
}

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
  const companies = whole ? tree.children : [tree];
  const coverage = orbatCoverage(data.roster, date);
  const vacancies = vacanciesOn(data.roster, date).filter((entry) => whole || entry.company === company.value);

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Order of Battle</h1>
          <p class="pagehead__sub">Who is on duty, from the CDO down.</p>
        </div>
      </header>

      <PageControls showRange={false}>
        <select
          class="field"
          aria-label="Parade date"
          value={date}
          onChange={(event) => setDate(event.currentTarget.value)}
        >
          {paradeDates
            .slice()
            .reverse()
            .map((d) => (
              <option key={d} value={d}>
                {fmtDate(d)}
              </option>
            ))}
        </select>
      </PageControls>

      <Card title={whole ? '40 SAR' : company.value}>
        <div class="orbat">
          {companies.map((node) => (
            <CompanyRoster key={node.name} node={node} />
          ))}
        </div>
        <Coverage>
          {fmtFraction(coverage.filedCount, COMPANIES.length)} companies filed a roster on {fmtDate(date)}.
          {vacancies.length > 0
            ? ' Filed vacant: ' + vacancies.map((entry) => entry.company + ' ' + entry.role).join(', ') + '.'
            : ' No appointment filed vacant.'}
        </Coverage>
      </Card>
    </div>
  );
}
