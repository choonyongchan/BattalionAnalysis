/**
 * Folds free-text Status reasons into ten fixed restriction buckets; one reason can land in several.
 * 'Other' only when none of the nine named restrictions match.
 */

import { classify, DUTY_CLASS } from './classify.ts';
import type { Cell } from './metrics.ts';
import { COMPANIES, PERM_STATUS_NUM_DAYS } from '../../../shared/domain.ts';
import type { PersonnelRow } from '../../../shared/dashboard.ts';
import { identityOf } from '../../../shared/identity.ts';
import { toNumber, toText } from '../../../shared/values.ts';

/** The ten Status buckets, in report order. */
export const STATUS_BUCKETS = [
  'Light Duty',
  'Excuse RMJ',
  'Excuse Heavy Load',
  'Excuse Upper Limb',
  'Excuse Uniform',
  'Excuse FLEGS/GELS',
  'Excuse Grenade/Pyro',
  'Excuse Kneeling/Squatting',
  'Excuse Stay-In',
  'Other',
];

/** The pattern routing text into each named bucket ('Other' has none). */
const BUCKET_PATTERNS: Record<string, RegExp> = {
  'Light Duty': /\bLD\b|light\s*duty/i,
  'Excuse RMJ': /\bRMJ\b/i,
  'Excuse Heavy Load': /heavy\s*loads?/i,
  'Excuse Upper Limb': /upper\s*limbs?|\bUL\b/i,
  'Excuse Uniform': /\bCU\b|uniform/i,
  'Excuse FLEGS/GELS': /\bFLEGS\b|\bGELS\b|\bflags?\b/i,
  'Excuse Grenade/Pyro': /pyro(technics)?|grenades?|explosives?/i,
  'Excuse Kneeling/Squatting': /kneel(ing)?|squat(ting)?/i,
  'Excuse Stay-In': /stay[\s-]?in/i,
};

/** The buckets a Status reason names, in report order; ['Other'] when none match, [] when blank. */
export function bucketsFor(reason: unknown): string[] {
  const text = toText(reason);
  if (text === '') return [];
  const matched = STATUS_BUCKETS.filter((bucket) => BUCKET_PATTERNS[bucket]?.test(text));
  return matched.length > 0 ? matched : ['Other'];
}

/** Whether a Status row is permanent: the 999 sentinel, or (what actually fires today) "perm" in the reason. */
export function isPermanentStatus(row: { numDays?: number | null; reason?: string | null }): boolean {
  return toNumber(row.numDays) === PERM_STATUS_NUM_DAYS || /\bperm/i.test(toText(row.reason));
}

/** A restriction x company cell naming the soldiers under it. */
export interface RestrictionCell extends Cell {
  names: string[];
}

/** Who cannot do what on one parade (null session = both); each soldier counts once per restriction, 'Other' left out. */
export function restrictionsOn(
  personnelRows: PersonnelRow[],
  isoDate: string,
  session: string | null,
): { rows: string[]; cells: RestrictionCell[] } {
  const byCell = new Map<string, Map<string, string>>();
  const onParade = personnelRows.filter(
    (row) => row.date === isoDate && (!session || row.session === session) && classify(row) === DUTY_CLASS.STATUS,
  );
  for (const row of onParade) {
    const key = identityOf(row).key;
    if (key === '') continue;
    for (const bucket of bucketsFor(row.reason).filter((name) => name !== 'Other')) {
      const cellKey = bucket + '|' + row.company;
      const soldiers = byCell.get(cellKey) ?? new Map<string, string>();
      soldiers.set(key, `${toText(row.rank)} ${toText(row.name)}`.trim());
      byCell.set(cellKey, soldiers);
    }
  }
  const rows = STATUS_BUCKETS.filter((bucket) => COMPANIES.some((company) => byCell.has(bucket + '|' + company)));
  const cells = rows.flatMap((bucket) =>
    COMPANIES.map((company) => {
      const soldiers = byCell.get(bucket + '|' + company) ?? new Map<string, string>();
      return { row: bucket, column: company, value: soldiers.size, names: Array.from(soldiers.values()).sort() };
    }),
  );
  return { rows, cells };
}
