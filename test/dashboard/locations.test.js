/**
 * Tests for folding 177 free-text clinic strings into canonical names.
 *
 * The risk worth covering is the fold hiding real places: six different strings all name
 * Changi General Hospital, and one is a plain typo of Ng Teng Fong General Hospital, so
 * they must collapse without a curated allowlist swallowing a clinic the lexicon has not
 * met yet — an unrecognised place must survive rather than becoming "Other".
 */

import { describe, expect, test } from 'bun:test';
import {
  canonicalLocation,
  locationCounts,
  locationCoverage,
} from '../../src/model/locations.js';

describe('canonicalLocation', () => {
  test('the six CGH forms fold to one canonical name', () => {
    const cghForms = [
      'CGH',
      'CHANGI GENERAL HOSPITAL',
      'CGH Urology',
      'Psychological Medicine Centre, Level 3, The Integrated Building, CGH',
      'CGH. Psychological Medicine Centre, Level 3, The Integrated Building',
      '2J - Rehabilitative Services @ IB Level 2, The Integrated Building, CGH',
    ];
    const canonical = new Set(cghForms.map(canonicalLocation));
    expect(canonical.size).toBe(1);
    expect(canonicalLocation('CGH')).toBe('Changi General Hospital');
  });

  test('the Ng Teng Fong typo folds to the correct name', () => {
    expect(canonicalLocation('Ng Teng Fong General Hospitalt')).toBe(
      'Ng Teng Fong General Hospital'
    );
  });

  test('NUH and its long form fold together, distinctly from SGH', () => {
    expect(canonicalLocation('NUH')).toBe(canonicalLocation('National University Hospital'));
    expect(canonicalLocation('SGH')).toBe(canonicalLocation('Singapore General Hospital'));
    expect(canonicalLocation('NUH')).not.toBe(canonicalLocation('SGH'));
  });

  test('CMPB variants fold together', () => {
    const canonical = canonicalLocation('CMPB');
    expect(canonicalLocation('CMPB Building, Clinic B')).toBe(canonical);
    expect(canonicalLocation('CMPB Regional Health Hub - Specialist Clinic B')).toBe(canonical);
    expect(canonicalLocation('CMPB Regional Healthhub')).toBe(canonical);
  });

  test('an unrecognised clinic survives, title-cased, rather than becoming Other', () => {
    expect(canonicalLocation('Some New Private Clinic')).toBe('Some New Private Clinic');
    expect(canonicalLocation('a walk-in medical centre')).toBe('A Walk-in Medical Centre');
  });

  test('a blank cell canonicalises to empty string', () => {
    expect(canonicalLocation('')).toBe('');
    expect(canonicalLocation(null)).toBe('');
  });
});

describe('locationCounts', () => {
  test('sorts folded locations by count descending and lists their raw variants', () => {
    const rows = [
      { location: 'CGH', reason_category: 'MA' },
      { location: 'CHANGI GENERAL HOSPITAL', reason_category: 'MA' },
      { location: 'CGH Urology', reason_category: 'MA' },
      { location: 'NUH', reason_category: 'MA' },
    ];
    const counts = locationCounts(rows, { category: 'MA' });
    expect(counts[0]).toEqual({
      location: 'Changi General Hospital',
      count: 3,
      variants: ['CGH', 'CHANGI GENERAL HOSPITAL', 'CGH Urology'],
    });
    expect(counts[1]).toEqual({
      location: 'National University Hospital',
      count: 1,
      variants: ['NUH'],
    });
  });

  test('restricts to the given reason_category', () => {
    const rows = [
      { location: 'CGH', reason_category: 'MA' },
      { location: 'CGH', reason_category: 'Att C' },
    ];
    expect(locationCounts(rows, { category: 'MA' })).toEqual([
      { location: 'Changi General Hospital', count: 1, variants: ['CGH'] },
    ]);
  });
});

describe('locationCoverage', () => {
  test('counts total rows in the category versus those naming a place', () => {
    const rows = [
      { location: 'CGH', reason_category: 'Att C' },
      { location: '', reason_category: 'Att C' },
      { location: '', reason_category: 'Att C' },
      { location: 'CGH', reason_category: 'MA' },
    ];
    expect(locationCoverage(rows, 'Att C')).toEqual({
      total: 3,
      withLocation: 1,
      share: 1 / 3,
    });
  });

  test('an empty category has a zero share rather than dividing by zero', () => {
    expect(locationCoverage([], 'Att C')).toEqual({ total: 0, withLocation: 0, share: 0 });
  });
});
