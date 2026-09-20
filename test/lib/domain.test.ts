/**
 * The shared vocabulary and normalisation rules.
 *
 * The most load-bearing test here is the last one: it pins `lib/domain.ts`'s name
 * normaliser against the dashboard's own, because they produce the identity key on opposite
 * sides of the wire. If they drift, soldiers silently split into two people and every
 * repeat-visit number quietly understates.
 */
import { describe, expect, test } from 'bun:test';
import {
  COMPANIES,
  REASON_CATEGORIES,
  cleanText,
  companyFromUnitCoy,
  normaliseFourD,
  normaliseName,
  paradeResponseId,
  unitTypeOf,
} from '../../lib/domain.ts';
import { normaliseName as dashboardNormaliseName } from '../../src/model/identity.js';

describe('the vocabulary comes from the database schema', () => {
  test('lists the five companies, without Scorpion', () => {
    expect(COMPANIES).toEqual(['Archer', 'Braves', 'Cougar', 'Stallion', 'Hercules']);
    expect(COMPANIES).not.toContain('Scorpion');
  });

  test('lists the six fixed section names', () => {
    expect(REASON_CATEGORIES).toEqual([
      'Att C',
      'Status',
      'Report Sick',
      'MA',
      'Off/Leave',
      'Others',
    ]);
  });
});

describe('cleanText', () => {
  test('removes the word joiner seen before entry numbers in real messages', () => {
    expect(cleanText('2. ⁠3SG NAME')).toBe('2. 3SG NAME');
  });

  test('turns non-breaking spaces into ordinary ones', () => {
    expect(cleanText('PL 7')).toBe('PL 7');
  });

  test('strips a byte-order mark', () => {
    expect(cleanText('﻿40 SAR')).toBe('40 SAR');
  });

  test('normalises CRLF and bare CR to LF', () => {
    expect(cleanText('a\r\nb\rc')).toBe('a\nb\nc');
  });
});

describe('normaliseName', () => {
  test('collapses case, punctuation and whitespace to one key', () => {
    expect(normaliseName('NG JUN WEI, CALEB')).toBe(normaliseName('Ng Jun Wei (Caleb)'));
  });

  test('is stable across the separators used by the two data streams', () => {
    expect(normaliseName('  TAN  AH   KOW ')).toBe('TAN AH KOW');
  });

  test('returns an empty key for blank input rather than throwing', () => {
    expect(normaliseName('')).toBe('');
    expect(normaliseName(null)).toBe('');
    expect(normaliseName(undefined)).toBe('');
  });

  test('survives the invisible characters found in real messages', () => {
    expect(normaliseName('TAN⁠ AH KOW')).toBe('TAN AH KOW');
  });
});

describe('normaliseFourD', () => {
  test('upper-cases and trims, because the same person types it both ways', () => {
    expect(normaliseFourD(' a1105 ')).toBe('A1105');
  });

  test('treats the placeholders soldiers type as no 4D at all', () => {
    for (const placeholder of ['NIL', 'nil', 'Nil', 'N/A', '-', 'REC']) {
      expect(normaliseFourD(placeholder)).toBeNull();
    }
  });

  test('keeps a bare numeric 4D as text, so leading zeros survive', () => {
    expect(normaliseFourD('0208')).toBe('0208');
  });
});

describe('paradeResponseId', () => {
  test('builds the key the whole write path depends on', () => {
    expect(paradeResponseId('Archer', '2026-09-18', 'FPS')).toBe('Archer_2026-09-18_FPS');
  });
});

describe('unitTypeOf', () => {
  test('recognises the company roll-up, which must never be summed with its blocks', () => {
    expect(unitTypeOf('Company')).toBe('Company');
  });

  test('recognises headquarters blocks in both spellings', () => {
    expect(unitTypeOf('COY HQ')).toBe('HQ');
    expect(unitTypeOf('HQ')).toBe('HQ');
  });

  test('recognises numbered platoons however they are written', () => {
    for (const label of ['PL 1', 'PL 9', 'PLT 3', 'PLATOON 2', 'PL2']) {
      expect(unitTypeOf(label)).toBe('PLATOON');
    }
  });

  test('treats the named blocks Stallion and Hercules file as sub-units', () => {
    for (const label of ['SIG', 'OPR+ASA', 'MED', 'PNR', 'SCR', 'MTR']) {
      expect(unitTypeOf(label)).toBe('SUBUNIT');
    }
  });
});

describe('companyFromUnitCoy', () => {
  test('maps every value of the real FormSG pick-list', () => {
    expect(companyFromUnitCoy('40 SAR / Archer')).toBe('Archer');
    expect(companyFromUnitCoy('40 SAR / Braves')).toBe('Braves');
    expect(companyFromUnitCoy('40 SAR / Cougar')).toBe('Cougar');
    expect(companyFromUnitCoy('40 SAR / Stallion')).toBe('Stallion');
  });

  test('folds battalion HQ into Hercules, as the battalion itself does', () => {
    expect(companyFromUnitCoy('40 SAR / Hercules & Bn HQ')).toBe('Hercules');
  });

  test('returns null rather than guessing at an unrecognised unit', () => {
    expect(companyFromUnitCoy('41 SAR / Someone Else')).toBeNull();
    expect(companyFromUnitCoy('')).toBeNull();
  });
});

describe('the identity key matches the dashboard', () => {
  /*
   * These two implementations live on opposite sides of the API and are the reason a
   * soldier resolves to one person rather than several. Until src/model/identity.js is
   * repointed at lib/domain.ts, this test is what holds them together.
   */
  const cases = [
    'NG JUN WEI, CALEB',
    'Ng Jun Wei (Caleb)',
    'MUHAMMAD ALI BIN OSMAN',
    'KUMAR S/O RAJAN',
    "O'BRIEN SEAN",
    '  double  spaced  ',
    'TAN AH KOW',
    '',
  ];

  for (const name of cases) {
    test(`agrees on ${JSON.stringify(name)}`, () => {
      expect(normaliseName(name)).toBe(dashboardNormaliseName(name));
    });
  }
});
