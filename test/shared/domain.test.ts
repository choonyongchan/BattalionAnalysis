/** Tests for the shared vocabulary: block labels, FormSG units and the parade submission key. */

import { describe, expect, test } from 'bun:test';
import {
  COMPANIES,
  companyFromUnitCoy,
  commandRolesOf,
  paradeResponseId,
  parseParadeResponseId,
  subunitPosition,
  unitTypeOf,
} from '../../shared/domain.ts';
import { companyEnum, reasonCategoryEnum } from '../../backend/db/schema.ts';

describe('the database enums are built from the shared lists', () => {
  test('companies, without Scorpion', () => {
    expect(companyEnum.enumValues).toEqual([...COMPANIES]);
    expect(COMPANIES).not.toContain('Scorpion' as never);
  });

  test('the six fixed section names, in database order', () => {
    expect(reasonCategoryEnum.enumValues).toEqual(['Att C', 'Status', 'Report Sick', 'MA', 'Off/Leave', 'Others']);
  });
});

describe('paradeResponseId', () => {
  test('builds the key the whole write path depends on', () => {
    expect(paradeResponseId('Archer', '2026-09-18', 'FPS')).toBe('Archer_2026-09-18_FPS');
  });

  test('parses back what it builds', () => {
    expect(parseParadeResponseId('Archer_2026-09-18_FPS')).toEqual({ company: 'Archer', date: '2026-09-18', session: 'FPS' });
  });

  test('refuses a malformed key or an unknown company', () => {
    expect(parseParadeResponseId('Archer-2026-09-18-FPS')).toBeNull();
    expect(parseParadeResponseId('Scorpion_2026-09-18_FPS')).toBeNull();
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
    for (const label of ['PL 1', 'PL 9', 'PLT 3', 'PLATOON 2', 'PL2']) expect(unitTypeOf(label)).toBe('PLATOON');
  });

  test('treats the named blocks Stallion and Hercules file as sub-units', () => {
    for (const label of ['SIG', 'OPR+ASA', 'MED', 'PNR', 'SCR', 'MTR']) expect(unitTypeOf(label)).toBe('SUBUNIT');
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

describe('sub-units', () => {
  test('a platoon sits at its position within its company', () => {
    expect(subunitPosition('Cougar', '7')).toBe(1);
    expect(subunitPosition('Stallion', 'Coy HQ')).toBe(0);
    expect(subunitPosition('Archer', '7')).toBe(-1);
    expect(subunitPosition('Nobody', '1')).toBe(-1);
  });

  test('a company files its command roles, then a PDS per sub-unit', () => {
    expect(commandRolesOf('Hercules')).toEqual(['CDO', 'CDS', 'COS', 'PDSSIG', 'PDSOPR+ASA', 'PDSMED']);
  });
});
