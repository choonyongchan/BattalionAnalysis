/**
 * Headcount against strength, for one day or across a range, battalion-wide or by company.
 * As a rate, a company that did not file is a gap (null), never a zero that reads as a collapse.
 */

import { classify, isDuty } from './classify.ts';
import { COMPANIES, UNIT_TYPE_COMPANY } from '../../../shared/domain.ts';
import type { PersonnelRow, StrengthRow } from '../../../shared/dashboard.ts';
import { identityOf } from '../../../shared/identity.ts';
import { battalionStrength, distinctDutyOn, onParade, type DutyFilter } from './metrics.ts';
import type { Trend } from './formsg.ts';
import { toNumber } from '../../../shared/values.ts';

/** Options shared by the trend builders. */
interface TrendOptions {
  /** 'battalion' (one series) or 'companies' (one per company). */
  scope?: string;
  session?: string;
  /** Divide by accountable strength (per 100); false gives raw headcounts. */
  asRate?: boolean;
}

/** A series whose values may be gaps. */
export interface GappyTrend {
  dates: string[];
  series: { name: string; values: (number | null)[] }[];
}

/** The company roll-up rows of one parade. */
function companyRowsOn(strengthRows: StrengthRow[], isoDate: string, session: string): StrengthRow[] {
  return strengthRows.filter((row) => onParade(row, isoDate, session) && row.unitType === UNIT_TYPE_COMPANY);
}

/** The three rank tiers a parade state splits strength into, in command order, with their columns. */
const RANK_TIERS = [
  { key: 'officer', label: 'Officers', strength: 'officerStrength', present: 'officerPresent' },
  { key: 'wospec', label: 'WOSpecs', strength: 'wospecStrength', present: 'wospecPresent' },
  { key: 'enlistee', label: 'Enlistees', strength: 'enlisteeStrength', present: 'enlisteePresent' },
] as const;

type RankTier = (typeof RANK_TIERS)[number];

/** One tier's totals; all null when no company stated it. */
export interface TierTotal {
  key: string;
  label: string;
  strength: number | null;
  present: number | null;
  percent: number | null;
}

/** One tier's stated strength and presence on a company row, or null when not stated. */
function tierOf(row: StrengthRow, tier: RankTier): { strength: number; present: number } | null {
  const strength = toNumber(row[tier.strength]);
  const present = toNumber(row[tier.present]);
  return strength === null || present === null ? null : { strength, present };
}

/** Sums the stated pairs of one tier; companies that did not state it are left out, not read as zero. */
function tierTotal(tier: RankTier, pairs: ({ strength: number; present: number } | null)[]): TierTotal {
  const stated = pairs.filter((pair) => pair !== null);
  if (stated.length === 0) return { key: tier.key, label: tier.label, strength: null, present: null, percent: null };
  const strength = stated.reduce((total, pair) => total + pair.strength, 0);
  const present = stated.reduce((total, pair) => total + pair.present, 0);
  return { key: tier.key, label: tier.label, strength, present, percent: strength > 0 ? (present / strength) * 100 : null };
}

/** Presence by rank tier on one parade, battalion-wide and per company that filed (a total can hide missing officers). */
export function tierPresence(
  strengthRows: StrengthRow[],
  isoDate: string,
  session = 'FPS',
): { battalion: TierTotal[]; byCompany: { company: string; tiers: TierTotal[] }[]; companiesWithoutSplit: string[] } {
  const byName = new Map(companyRowsOn(strengthRows, isoDate, session).map((row) => [row.company as string, row]));
  const filed = COMPANIES.filter((company) => byName.has(company));
  const byCompany = filed.map((company) => ({
    company,
    tiers: RANK_TIERS.map((tier) => tierTotal(tier, [tierOf(byName.get(company)!, tier)])),
  }));
  return {
    battalion: RANK_TIERS.map((tier) => tierTotal(tier, filed.map((company) => tierOf(byName.get(company)!, tier)))),
    byCompany,
    companiesWithoutSplit: byCompany.filter((entry) => entry.tiers.every((tier) => tier.strength === null)).map((entry) => entry.company),
  };
}

/** Accountable and present strength per company that filed one parade. */
function companyStrengthOn(strengthRows: StrengthRow[], isoDate: string, session: string): Map<string, { strength: number | null; present: number | null }> {
  return new Map(
    companyRowsOn(strengthRows, isoDate, session).map((row) => [
      row.company as string,
      { strength: toNumber(row.totalStrength), present: toNumber(row.totalPresent) },
    ]),
  );
}

/** Present soldiers per day: a headcount (bodies, not a ratio), battalion-wide or per company. */
export function presentTrend(strengthRows: StrengthRow[], dates: string[], { scope = 'battalion', session = 'FPS' }: TrendOptions = {}): GappyTrend {
  if (scope === 'companies') {
    const perDate = dates.map((date) => companyStrengthOn(strengthRows, date, session));
    return {
      dates,
      series: COMPANIES.map((company) => ({ name: company, values: perDate.map((byCompany) => byCompany.get(company)?.present ?? 0) })),
    };
  }
  const values = dates.map((date) => {
    const strength = battalionStrength(strengthRows, date, session);
    return strength.companiesReporting.length === 0 ? 0 : strength.present;
  });
  return { dates, series: [{ name: 'Battalion', values }] };
}

/** Distinct soldiers in a duty class per company on one parade (a soldier in both sessions counts once). */
function dutyCountsByCompany(personnelRows: PersonnelRow[], isoDate: string, session: string, dutyClass: DutyFilter): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const row of personnelRows) {
    if (row.date !== isoDate || row.session !== session || !isDuty(dutyClass, classify(row))) continue;
    const { key } = identityOf(row);
    if (key !== '') seen.set(row.company, (seen.get(row.company) ?? new Set()).add(key));
  }
  return new Map(Array.from(seen, ([company, keys]) => [company, keys.size]));
}

/**
 * A duty class per day, battalion-wide or per company. As a rate (default) each unit is divided by its own
 * accountable strength so sizes compare; `asRate: false` gives the headcount the Overview shows.
 */
export function dutyTrend(
  personnelRows: PersonnelRow[],
  strengthRows: StrengthRow[],
  dutyClass: DutyFilter,
  dates: string[],
  { scope = 'battalion', session = 'FPS', asRate = true }: TrendOptions = {},
): GappyTrend {
  const valueOf = (count: number, strength: number | null) => {
    if (!asRate) return count;
    return strength !== null && strength > 0 ? (count / strength) * 100 : null;
  };

  if (scope === 'companies') {
    const perDate = dates.map((date) => ({
      strength: companyStrengthOn(strengthRows, date, session),
      duty: dutyCountsByCompany(personnelRows, date, session, dutyClass),
    }));
    return {
      dates,
      series: COMPANIES.map((company) => ({
        name: company,
        values: perDate.map((day) => {
          const entry = day.strength.get(company);
          if (!entry) return asRate ? null : 0;
          return valueOf(day.duty.get(company) ?? 0, entry.strength);
        }),
      })),
    };
  }

  const values = dates.map((date) => {
    const strength = battalionStrength(strengthRows, date, session);
    if (strength.companiesReporting.length === 0) return asRate ? null : 0;
    // Distinct soldiers, so someone on MC and MA is one.
    return valueOf(distinctDutyOn(personnelRows, date, session, dutyClass), strength.accountable);
  });
  return { dates, series: [{ name: 'Battalion', values }] };
}
