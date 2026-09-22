/**
 * Tests for folding 403 free-text Status reasons into ten buckets.
 *
 * The risk worth covering is the vocabulary collapse: one restriction is typed at least
 * four different ways ("Excuse RMJ" / "EX RMJ" / "RMJ" / a sentence naming it alongside
 * others), and a row commonly names several restrictions at once, so the match must be
 * multi-label without producing duplicates. Permanence is the other risk — the intended
 * sentinel (`num_days` 999) does not appear anywhere in the real data, so the fallback on
 * `reason` text is what actually carries the signal today.
 */

import { describe, expect, test } from 'bun:test';
import { bucketsFor, isPermanentStatus, STATUS_BUCKETS } from '../../src/model/statusBuckets.js';
import { PERM_STATUS_NUM_DAYS } from '../../src/model/domain.js';

describe('STATUS_BUCKETS', () => {
  test('lists exactly the ten buckets in the documented order', () => {
    expect(STATUS_BUCKETS).toEqual([
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
    ]);
  });
});

describe('bucketsFor', () => {
  test('the four spellings of RMJ collapse to one bucket', () => {
    ['Excuse RMJ', 'EX RMJ', 'RMJ', 'EXCUSE RMJ, HEAVY LOADS, KNEELING, SQUATTING'].forEach(
      (reason) => {
        expect(bucketsFor(reason)).toContain('Excuse RMJ');
      }
    );
  });

  test('a multi-restriction reason yields several buckets with no duplicates', () => {
    const buckets = bucketsFor('EXCUSE RMJ, HEAVY LOADS, KNEELING, SQUATTING');
    expect(buckets).toEqual([
      'Excuse RMJ',
      'Excuse Heavy Load',
      'Excuse Kneeling/Squatting',
    ]);
    expect(new Set(buckets).size).toBe(buckets.length);
  });

  test('"Flags" reaches Excuse FLEGS/GELS, the same family as FLEGS/GELS', () => {
    expect(bucketsFor('Excuse Flags')).toEqual(['Excuse FLEGS/GELS']);
    expect(bucketsFor('EXCUSE FLEGS')).toEqual(['Excuse FLEGS/GELS']);
    expect(bucketsFor('Excuse GELS')).toEqual(['Excuse FLEGS/GELS']);
  });

  test('"EX CU" reaches Excuse Uniform', () => {
    expect(bucketsFor('EX CU')).toEqual(['Excuse Uniform']);
  });

  test('grenade, pyrotechnics and explosives all reach Excuse Grenade/Pyro', () => {
    expect(bucketsFor('EXCUSE PYROTECHNICS')).toEqual(['Excuse Grenade/Pyro']);
    expect(bucketsFor('EXCUSE GRENADE, PYROTECHNICS')).toEqual(['Excuse Grenade/Pyro']);
    expect(
      bucketsFor('Excuse Grenade & Explosives, Loud Noise Environment, Loud Noise Vocation')
    ).toEqual(['Excuse Grenade/Pyro']);
  });

  test('a bare diagnosis like Fever reaches Other, not left unrecognised', () => {
    expect(bucketsFor('Fever')).toEqual(['Other']);
  });

  test('a reason matching nothing recognised still yields Other', () => {
    expect(bucketsFor('Some entirely novel restriction nobody has typed before')).toEqual([
      'Other',
    ]);
  });

  test('a blank reason yields no buckets at all, distinct from an unrecognised one', () => {
    expect(bucketsFor('')).toEqual([]);
    expect(bucketsFor(null)).toEqual([]);
  });

  test('LD is read as Light Duty', () => {
    expect(bucketsFor('LD')).toEqual(['Light Duty']);
  });

  test('UL is read as Excuse Upper Limb', () => {
    expect(bucketsFor('EX UL')).toEqual(['Excuse Upper Limb']);
  });

  test('Excuse Stay In (no hyphen) reaches Excuse Stay-In', () => {
    expect(bucketsFor('Excuse Stay In')).toEqual(['Excuse Stay-In']);
  });

  test('Sharps, Sunlight, PT, Live Firing, Prolonged Standing and Range fall to Other', () => {
    ['EX SHARPS', 'EXCUSE SUNLIGHT', 'Excuse PT', 'Excuse Live Firing', 'EX PROLONGED STANDING', 'Range'].forEach(
      (reason) => {
        expect(bucketsFor(reason)).toEqual(['Other']);
      }
    );
  });
});

describe('isPermanentStatus', () => {
  test('recognises permanence from reason text when num_days is blank, the common case', () => {
    expect(
      isPermanentStatus({ reason: 'PERMANENT EXCUSE PYROTECHNICS', num_days: '' })
    ).toBe(true);
    expect(isPermanentStatus({ reason: 'Perm Excuse Grenade & Explosives', num_days: '' })).toBe(
      true
    );
  });

  test('recognises permanence from the num_days sentinel when it is present', () => {
    expect(
      isPermanentStatus({ reason: 'Excuse RMJ', num_days: PERM_STATUS_NUM_DAYS })
    ).toBe(true);
  });

  test('a dated status is not permanent', () => {
    expect(isPermanentStatus({ reason: 'Excuse RMJ', num_days: 14 })).toBe(false);
  });
});
