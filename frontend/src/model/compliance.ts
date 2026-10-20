/**
 * Report-sick compliance: soldiers the parade state lists as reporting sick, matched by name to FormSG
 * submissions on the same day (4D first, then a typo-tolerant name match), one form per soldier.
 */

import { identityKey } from '../../../shared/identity.ts';
import type { PersonnelRow } from '../../../shared/dashboard.ts';
import { DUTY_CLASS, classify } from './classify.ts';
import { withinRange } from './dateRange.ts';
import type { Submission } from './formsg.ts';
import type { FlowNode, Link } from './sankey.ts';
import { fuzzyNamesMatch } from './sft.ts';

/** One soldier on one side only. */
export interface ComplianceRow {
  date: string;
  company: string;
  rank: string;
  name: string;
  fourD: string;
}

/** What the compliance page shows. */
export interface Compliance {
  matched: number;
  /** On the parade state, no FormSG that day: failed compliance. */
  missing: ComplianceRow[];
  /** On FormSG, not on that day's parade state. */
  formOnly: ComplianceRow[];
  /** 1 − missing ÷ on parade state; null when nobody was reporting sick. */
  compliance: number | null;
  nodes: FlowNode[];
  links: Link[];
}

/** Report Sick rows in range, once per soldier per day (FPS and LPS list the same soldier). */
function paradeEntries(personnel: PersonnelRow[], from: string | null, to: string | null): PersonnelRow[] {
  const seen = new Set<string>();
  return personnel.filter((row) => {
    if (classify(row) !== DUTY_CLASS.REPORT_SICK || !withinRange(row.date, from, to)) return false;
    const key = row.date + '|' + (identityKey(row.fourD, row.name) || row.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The index of the first unused same-day submission for a soldier: 4D match first, then name. */
function matchIndex(row: PersonnelRow, forms: Submission[], used: Set<number>): number {
  const key = identityKey(row.fourD, row.name);
  const free = (form: Submission, index: number) => !used.has(index) && form.date === row.date;
  const byKey = forms.findIndex((form, index) => free(form, index) && key.startsWith('4D:') && form.key === key);
  return byKey >= 0 ? byKey : forms.findIndex((form, index) => free(form, index) && fuzzyNamesMatch(row.name, form.name));
}

/** Matches parade-state report-sick entries to FormSG submissions over the range. */
export function reportSickCompliance(
  personnel: PersonnelRow[],
  submissions: Submission[],
  from: string | null,
  to: string | null,
): Compliance {
  // ponytail: linear scan per soldier; index forms by date if ranges grow past a few thousand rows.
  const forms = submissions.filter((form) => withinRange(form.date, from, to));
  const entries = paradeEntries(personnel, from, to);
  const used = new Set<number>();
  const missing: ComplianceRow[] = [];
  for (const row of entries) {
    const index = matchIndex(row, forms, used);
    if (index >= 0) used.add(index);
    else missing.push({ date: row.date, company: row.company, rank: row.rank ?? '', name: row.name, fourD: row.fourD ?? '' });
  }
  const formOnly = forms
    .filter((_, index) => !used.has(index))
    .map((form) => ({ date: form.date, company: form.company, rank: form.rank, name: form.name, fourD: form.fourD }));
  const matched = used.size;

  // Node names are the Trends flow's, so the shared Sankey colours them (absences grey) unchanged.
  const links = [
    { source: 'Reporting sick', target: 'Reported sick', value: matched },
    { source: 'Reporting sick', target: 'No FormSG submission', value: missing.length },
    { source: 'Unaccounted', target: 'Reported sick', value: formOnly.length },
  ].filter((link) => link.value > 0);
  const stageOf = (name: string) => (name === 'Reporting sick' || name === 'Unaccounted' ? 'reporting' : 'reported');
  const names = Array.from(new Set(links.flatMap((link) => [link.source, link.target])));
  return {
    matched,
    missing,
    formOnly,
    compliance: entries.length > 0 ? 1 - missing.length / entries.length : null,
    nodes: names.map((name) => ({ name, stage: stageOf(name) })),
    links,
  };
}
