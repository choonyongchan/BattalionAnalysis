/**
 * Restricts loaded data to one company. Every comparison is a rate over a unit's own rows, so
 * filtering once here is enough; `ALL` (or anything not a company) passes the input through unchanged.
 */

import { isCompany } from '../../../shared/domain.ts';
import type { Dataset } from '../data/feed.ts';

/** The selector value meaning the whole battalion. */
export const ALL_COMPANIES = 'ALL';

/** The rows belonging to `company`, or the same array when it is not a real company. */
export function onlyCompany<T extends { company?: string | null }>(rows: T[], company: string): T[] {
  return isCompany(company) ? rows.filter((row) => row.company === company) : rows;
}

/** A dataset with every row array restricted to one company; the same object for `ALL`. */
export function scopeDataset<D extends Dataset | null>(data: D, company: string): D {
  if (!data || !isCompany(company)) return data;
  return {
    ...data,
    strength: onlyCompany(data.strength, company),
    personnel: onlyCompany(data.personnel, company),
    roster: onlyCompany(data.roster, company),
    formSg: onlyCompany(data.formSg, company),
    sft: onlyCompany(data.sft, company),
    sectionCounts: onlyCompany(data.sectionCounts, company),
  };
}
