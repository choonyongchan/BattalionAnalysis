/**
 * Duty Roster: who is on duty on one parade, a card per company with its chain of command. A company that
 * filed nothing still shows (that absence is the finding); a role filed as `-` reads Vacant.
 */

import { useMemo, useState } from 'preact/hooks';
import { company, loadedData } from '../app/state.ts';
import { Card, Coverage, EmptyState } from '../components/Card.tsx';
import { PageControls } from '../components/PageControls.tsx';
import { COMPANIES, isCompany } from '../../../shared/domain.ts';
import { datesPresent } from '../model/metrics.ts';
import { dutyRosterCoverage, dutyRosterTree, rosterClashes, rosterLoad, vacanciesOn, type TreeNode } from '../model/dutyRoster.ts';
import type { PersonnelRow, RosterRow } from '../../../shared/dashboard.ts';
import { DataTable } from '../components/Table.tsx';
import { onlyCompany, scopeDataset } from '../model/scope.ts';
import { fmtDate, fmtFraction, fmtInt } from '../format.ts';
import { settingOf } from '../model/activeSettings.ts';

/** One role and, indented beneath it, the roles that report to it. */
function RoleItem({ node }: { node: TreeNode }) {
  const children = node.children;
  return (
    <li class="duty-roster__item">
      <div class={'duty-roster__role' + (node.vacant ? ' duty-roster__role--vacant' : node.filed ? '' : ' duty-roster__role--unfiled')}>
        <span class="duty-roster__tag">{node.role}</span>
        <span class="duty-roster__name">{node.name}</span>
      </div>
      {children.length > 0 ? (
        <ul class="duty-roster__list">
          {children.map((child) => (
            <RoleItem key={child.role} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One company's card: its name in the company's colour, then its chain of command. */
function CompanyRoster({ node }: { node: TreeNode }) {
  const [top] = node.children;
  return (
    <section class={'duty-roster__company duty-roster__company--' + node.name.toLowerCase()}>
      <h3 class="duty-roster__heading">{node.name}</h3>
      {node.filed && top ? (
        <ul class="duty-roster__list duty-roster__list--root">
          <RoleItem node={top} />
        </ul>
      ) : (
        <p class="duty-roster__none">No roster filed</p>
      )}
    </section>
  );
}

/** People the duty-load table lists. */
const LOAD_ROWS = 15;

/**
 * Who has done the most duties since the roster began, weekends counted apart, and every duty filed for
 * someone the same parade lists on MC or leave.
 */
function DutyFairness({ roster, personnel, since }: { roster: RosterRow[]; personnel: PersonnelRow[]; since: string | null }) {
  const load = useMemo(() => rosterLoad(roster).slice(0, LOAD_ROWS), [roster]);
  const clashes = useMemo(() => rosterClashes(roster, personnel), [roster, personnel]);
  return (
    <div class="grid-2">
      <Card title="Duty Load" note={'CDO, CDS, COS and PDS duties per person' + (since ? ' since ' + fmtDate(since) : '')}>
        {load.length === 0 ? (
          <EmptyState>No duty filed yet.</EmptyState>
        ) : (
          <DataTable
            columns={[
              { key: 'who', label: 'Name' },
              { key: 'all', label: 'Duties', numeric: true },
              { key: 'wknd', label: 'On a weekend', numeric: true },
            ]}
            rows={load.map((row) => ({ who: (row.rank + ' ' + row.name).trim(), all: fmtInt(row.duties), wknd: fmtInt(row.weekend) }))}
            rowKey={(row) => row.who}
          />
        )}
      </Card>
      <Card title="On Duty While Away" note="Duties filed for someone the same parade state lists on MC or leave">
        {clashes.length === 0 ? (
          <EmptyState>No duty clashes with an MC or leave.</EmptyState>
        ) : (
          <DataTable
            columns={[
              { key: 'day', label: 'Date' },
              { key: 'appointment', label: 'Duty' },
              { key: 'who', label: 'Name' },
              { key: 'away', label: 'Listed as' },
            ]}
            rows={clashes.map((row) => ({ ...row, day: fmtDate(row.date), who: (row.rank + ' ' + row.name).trim() }))}
            rowKey={(row) => row.date + row.appointment + row.name}
          />
        )}
      </Card>
    </div>
  );
}

/** The Duty Roster page. */
export function DutyRoster() {
  const data = loadedData();
  const paradeDates = useMemo(() => datesPresent(data.strength), [data.strength]);
  const [date, setDate] = useState(paradeDates[paradeDates.length - 1] ?? null);
  const whole = !isCompany(company.value);
  const scoped = useMemo(() => scopeDataset(data, company.value), [data, company.value]);

  if (!date) {
    return (
      <div class="page">
        <header class="pagehead">
          <h1 class="pagehead__title">Duty Roster</h1>
        </header>
        <EmptyState>No parade state has been read yet.</EmptyState>
      </div>
    );
  }

  const tree = dutyRosterTree(data.roster, date, whole ? undefined : { company: company.value });
  const companies = whole ? tree.children : [tree];
  const coverage = dutyRosterCoverage(data.roster, date);
  const vacancies = onlyCompany(vacanciesOn(data.roster, date), company.value);

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Duty Roster</h1>
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
            .map((day) => (
              <option key={day} value={day}>
                {fmtDate(day)}
              </option>
            ))}
        </select>
      </PageControls>

      <Card title={whole ? settingOf('unit').name : company.value}>
        <div class="duty-roster">
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

      <DutyFairness roster={scoped.roster} personnel={scoped.personnel} since={paradeDates[0] ?? null} />
    </div>
  );
}
