/**
 * Folds the free-text clinic `location` into a canonical name (CGH alone is written six ways).
 * Matching is by substring; an unknown clinic is kept, title-cased, never lumped into "Other".
 */

import { toText } from '../../../shared/values.ts';

/** Alias patterns, mutually exclusive so match order does not matter. */
const LOCATION_ALIASES: { canonical: string; pattern: RegExp }[] = [
  { canonical: 'Changi General Hospital', pattern: /\bCGH\b|CHANGI\s*GENERAL\s*HOSPITAL/i },
  { canonical: 'Ng Teng Fong General Hospital', pattern: /NG\s*TENG\s*FONG/i },
  { canonical: 'National University Hospital', pattern: /\bNUH\b|NATIONAL\s*UNIVERSITY\s*HOSPITAL/i },
  { canonical: 'Singapore General Hospital', pattern: /\bSGH\b|SINGAPORE\s*GENERAL\s*HOSPITAL/i },
  { canonical: 'CMPB', pattern: /\bCMPB\b/i },
  { canonical: 'Khoo Teck Puat Hospital', pattern: /KHOO\s*TECK\s*PUAT|\bKTPH\b/i },
  { canonical: 'Alexandra Hospital', pattern: /ALEXANDRA\s*HOSPITAL/i },
  { canonical: 'Carehub@BMTC', pattern: /CAREHUB/i },
  { canonical: 'Institute of Mental Health', pattern: /\bIMH\b|INSTITUTE\s*OF\s*MENTAL\s*HEALTH/i },
  { canonical: 'Singapore Changi Aeromedical Centre', pattern: /AEROMED/i },
  { canonical: 'Kallang Polyclinic', pattern: /KALLANG\s*POLYCLINIC/i },
  { canonical: 'Woodlands Polyclinic', pattern: /WOODLANDS\s*POLYCLINIC/i },
  { canonical: 'Asiamedic Orchard Imaging Centre', pattern: /ASIAMEDIC/i },
];

/** A row naming a clinic. */
type LocatedRow = { reasonCategory?: string | null; location?: string | null };

/** Title-cases each word without capitalising inside it ("walk-in" stays "Walk-in"). */
function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .map((word) => (word === '' ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase()))
    .join(' ');
}

/** The canonical clinic name, the input title-cased when unknown, or '' when blank. */
export function canonicalLocation(text: unknown): string {
  const trimmed = toText(text);
  if (trimmed === '') return '';
  const alias = LOCATION_ALIASES.find((entry) => entry.pattern.test(trimmed.toUpperCase()));
  return alias ? alias.canonical : titleCase(trimmed);
}

/** Rows per canonical clinic with the raw spellings folded into it, most first (ties alphabetical). */
export function locationCounts(
  rows: LocatedRow[],
  options: { category?: string } = {},
): { location: string; count: number; variants: string[] }[] {
  const groups = new Map<string, { count: number; variants: string[] }>();
  for (const row of rows) {
    if (options.category && toText(row.reasonCategory) !== options.category) continue;
    const raw = toText(row.location);
    if (raw === '') continue;
    const location = canonicalLocation(raw);
    const group = groups.get(location) ?? { count: 0, variants: [] };
    group.count += 1;
    if (!group.variants.includes(raw)) group.variants.push(raw);
    groups.set(location, group);
  }
  return Array.from(groups, ([location, group]) => ({ location, ...group })).sort(
    (a, b) => b.count - a.count || a.location.localeCompare(b.location),
  );
}

/** How many rows of one section name a clinic at all, with the 0..1 share. */
export function locationCoverage(rows: LocatedRow[], category: string): { total: number; withLocation: number; share: number } {
  const filtered = rows.filter((row) => toText(row.reasonCategory) === category);
  const withLocation = filtered.filter((row) => toText(row.location) !== '').length;
  return { total: filtered.length, withLocation, share: filtered.length === 0 ? 0 : withLocation / filtered.length };
}
