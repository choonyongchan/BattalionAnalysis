/**
 * Resolves a soldier to a stable key across parade states and FormSG.
 * The 4D is preferred; a normalised name is the fallback, since 14% of personnel rows have no 4D.
 */

import { toText } from './values.ts';

/** Zero-width characters and NBSPs seen in real messages; they make equal-looking names compare unequal. */
const INVISIBLES = /[ ᠎​-‍⁠﻿]/g;

/** Strips invisible characters, turns NBSP into a space and CRLF/CR into LF. */
export function cleanText(text: string): string {
  return text.replace(/ /g, ' ').replace(INVISIBLES, '').replace(/\r\n?/g, '\n');
}

/** Upper-cased name with punctuation and extra spaces removed, e.g. "NG JUN WEI CALEB"; '' when blank. */
export function normaliseName(name: unknown): string {
  return cleanText(toText(name))
    .toUpperCase()
    .replace(/[.,'"()/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What soldiers type when they have no 4D; read as no 4D at all. */
const FOUR_D_PLACEHOLDERS = new Set(['NIL', 'NA', 'N/A', 'NONE', '-', 'REC']);

/** Trimmed upper-case 4D, or '' when blank or a placeholder such as "NIL". */
export function normaliseFourD(fourD: unknown): string {
  const value = cleanText(toText(fourD)).toUpperCase().trim();
  return FOUR_D_PLACEHOLDERS.has(value) ? '' : value;
}

/** `normaliseFourD` for a nullable column: null instead of ''. */
export function fourDOrNull(fourD: unknown): string | null {
  return normaliseFourD(fourD) || null;
}

/** The one identity key builder (`4D:…` or `NAME:…`, '' when neither); FormSG and parade rows join on it. */
export function identityKey(fourD: unknown, name: unknown): string {
  const digits = normaliseFourD(fourD);
  if (digits !== '') return '4D:' + digits;
  const normalised = normaliseName(name);
  return normalised === '' ? '' : 'NAME:' + normalised;
}

/** Identity key of a row with `fourD` and `name`, and which field produced it. */
export function identityOf(row: { fourD?: unknown; name?: unknown }): { key: string; source: 'fourD' | 'name' | 'none' } {
  const key = identityKey(row.fourD, row.name);
  if (key === '') return { key, source: 'none' };
  return { key, source: key.startsWith('4D:') ? 'fourD' : 'name' };
}

/** Rank tokens that may survive into a name field and must not drive a match. */
const RANKS = new Set([
  'REC', 'PTE', 'LCP', 'LCPL', 'CPL', '1PTE', '2PTE', '3SG', '2SG', '1SG', 'SSG', 'MSG',
  '1WO', '2WO', '3WO', 'MWO', 'CWO', 'SWO', 'OCT', 'OFC', '2LT', 'LTA', 'CPT', 'MAJ',
  'LTC', 'SLTC', 'COL', 'BG', 'ME1', 'ME2', 'ME3', 'ME4', 'ME5', 'DR',
]);

/** Name connectors with no identifying weight on their own. */
const CONNECTORS = new Set(['BIN', 'BINTE', 'BTE']);

/** A name's identifying words: no initials, ranks or connectors. */
export function nameTokens(name: unknown): string[] {
  return normaliseName(name)
    .split(' ')
    .filter((token) => token.length > 1 && !RANKS.has(token) && !CONNECTORS.has(token));
}

/**
 * Whether two names plausibly belong to one soldier: every token of the shorter name (2+) shared,
 * or a 60% overlap. `same` decides when two tokens are one word (exact by default; SFT allows typos).
 */
export function namesMatch(a: unknown, b: unknown, same: (x: string, y: string) => boolean = (x, y) => x === y): boolean {
  const tokensA = [...new Set(nameTokens(a))];
  const unmatched = [...new Set(nameTokens(b))];
  const sizeB = unmatched.length;
  if (tokensA.length === 0 || sizeB === 0) return false;
  let shared = 0;
  for (const token of tokensA) {
    const index = unmatched.findIndex((other) => same(token, other));
    if (index >= 0) {
      unmatched.splice(index, 1);
      shared += 1;
    }
  }
  const smaller = Math.min(tokensA.length, sizeB);
  return (smaller >= 2 && shared === smaller) || shared / (tokensA.length + sizeB - shared) >= 0.6;
}
