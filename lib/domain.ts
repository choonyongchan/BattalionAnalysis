/**
 * Pure vocabulary and normalisation shared by the WhatsApp parser and FormSG intake.
 * Enum values come from `db/schema.ts`; the dashboard keeps its own copy in `src/model/domain.js`.
 */
import {
  companyEnum,
  reasonCategoryEnum,
  reportSickTypeEnum,
  roleKindEnum,
  sessionEnum,
  unitTypeEnum,
} from '../db/schema.ts';

export const COMPANIES = companyEnum.enumValues;
export const SESSIONS = sessionEnum.enumValues;
export const REASON_CATEGORIES = reasonCategoryEnum.enumValues;
export const ROLE_KINDS = roleKindEnum.enumValues;
export const REPORT_SICK_TYPES = reportSickTypeEnum.enumValues;

export type Company = (typeof COMPANIES)[number];
export type UnitType = (typeof unitTypeEnum.enumValues)[number];

/**
 * Characters that carry no identity information but vary between how two people type the
 * same name: "NG JUN WEI, CALEB" against "Ng Jun Wei (Caleb)".
 */
const NAME_PUNCTUATION = /[.,'"()\/-]/g;

/**
 * Invisible characters observed in real messages.
 *
 * The reference corpus contains U+2060 WORD JOINER before an entry number in two Stallion
 * blocks, presumably from a phone keyboard. Non-breaking spaces appear in pasted text.
 * These break a naive `split(' ')` and produce names that look identical but do not
 * compare equal, so they are removed before anything else looks at the text.
 */
const INVISIBLES = /[ ᠎​-‍⁠﻿]/g;

/**
 * Strips invisible characters and normalises line endings.
 *
 * Applied to a whole message before parsing, and to individual fields before comparison.
 *
 * @param text Raw text, from a WhatsApp relay or a form answer.
 * @returns The same text with zero-width and non-breaking characters removed, non-breaking
 *   spaces turned into ordinary ones, and CRLF/CR reduced to LF.
 */
export function cleanText(text: string): string {
  return text
    .replace(/ /g, ' ')
    .replace(INVISIBLES, '')
    .replace(/\r\n?/g, '\n');
}

/**
 * Normalises a person's name for use as an identity key.
 *
 * Collapses case, punctuation and runs of whitespace, so "NG JUN WEI, CALEB" and
 * "Ng Jun Wei Caleb" resolve to the same soldier. This is the algorithm
 * `src/model/identity.js` already uses; `test/lib/domain.test.ts` pins the two together so
 * the server and the dashboard cannot drift apart.
 *
 * This is the identity key for both data streams. It is deliberately not `four_d`: across
 * 2,376 FormSG submissions, 204 of 803 people typed inconsistent 4D strings, 142 distinct
 * 4D values mapped to more than one person, and 50 were `NIL` placeholders. Name was 1:1
 * with NRIC for all 803.
 *
 * @param name A name as written, from either data stream.
 * @returns A normalised key, or '' when the name is blank.
 */
export function normaliseName(name: string | null | undefined): string {
  if (!name) return '';
  return cleanText(String(name))
    .toUpperCase()
    .replace(NAME_PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Placeholders soldiers type when they have no 4D number. */
const FOUR_D_PLACEHOLDERS = new Set(['NIL', 'NA', 'N/A', 'NONE', '-', 'REC']);

/**
 * Normalises a 4D number to a comparable attribute value.
 *
 * Never a key -- see `normaliseName`. Kept because it is what a commander searches by, and
 * because it is the only thing that disambiguates two soldiers who share a name.
 *
 * @param fourD A 4D number as typed, e.g. "a1105", " 2208 ", "NIL".
 * @returns The trimmed upper-case value, or null when blank or a placeholder.
 */
export function normaliseFourD(fourD: string | null | undefined): string | null {
  if (!fourD) return null;
  const value = cleanText(String(fourD)).toUpperCase().trim();
  if (value === '' || FOUR_D_PLACEHOLDERS.has(value)) return null;
  return value;
}

/**
 * Builds the primary key for a parade submission.
 *
 * The same `${company}_${isoDate}_${session}` shape the spreadsheet used. It stays a
 * computable natural key because neon-http has no interactive transactions: the whole
 * delete-and-replace cycle has to fit one `db.batch([...])`, where no statement may depend
 * on an earlier statement's `RETURNING`. A surrogate id would need a round trip first.
 *
 * @param company One of the five companies.
 * @param isoDate The parade date as `yyyy-MM-dd`.
 * @param session FPS or LPS.
 * @returns The submission key, e.g. `Archer_2026-09-18_FPS`.
 */
export function paradeResponseId(company: string, isoDate: string, session: string): string {
  return `${company}_${isoDate}_${session}`;
}

/** Numbered platoon blocks: `PL 7`, `PLT 3`, `PLATOON 1`, `PL2`. */
export const PLATOON_LABEL = /^(?:PL|PLT|PLATOON)\s*\d+$/;
/** Headquarters blocks: `COY HQ`, `HQ`. */
export const HQ_LABEL = /^(?:COY\s*)?HQ$/;

/**
 * Classifies a unit block label so that totals are never summed across levels.
 *
 * `Company` is the roll-up at the top of the message; summing it together with the blocks
 * beneath double-counts the whole company, which is the single easiest way to produce a
 * confidently wrong number from this data.
 *
 * Anything that is neither the roll-up, a headquarters block nor a numbered platoon is a
 * SUBUNIT: the named blocks Stallion and Hercules file -- SIG, OPR+ASA, MED, PNR, SCR, MTR.
 *
 * @param unitLabel The block label as written in the message.
 * @returns The unit type for that block.
 */
export function unitTypeOf(unitLabel: string): UnitType {
  const label = cleanText(unitLabel).toUpperCase().trim();
  if (label === 'COMPANY') return 'Company';
  if (HQ_LABEL.test(label)) return 'HQ';
  if (PLATOON_LABEL.test(label)) return 'PLATOON';
  return 'SUBUNIT';
}

/**
 * Maps FormSG's `Unit & Coy` pick-list to a company.
 *
 * The pick-list is clean -- five values, zero spelling variants across 2,376 responses --
 * so this is a lookup rather than fuzzy matching. `40 SAR / Hercules & Bn HQ` folds
 * battalion HQ into Hercules, which is how the battalion itself groups them.
 *
 * @param unitCoy The answer to the `Unit & Coy` question.
 * @returns The company, or null when the answer matches none (which should be logged, not
 *   guessed at).
 */
export function companyFromUnitCoy(unitCoy: string | null | undefined): Company | null {
  if (!unitCoy) return null;
  const value = cleanText(String(unitCoy)).toUpperCase();
  return COMPANIES.find((company) => value.includes(company.toUpperCase())) ?? null;
}
