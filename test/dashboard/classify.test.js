/**
 * Tests for duty classification and symptom extraction.
 *
 * The most valuable cases here are the two the design was corrected into. `Att C` *is*
 * MC, so every `Att C` row counts as MC whatever its `reason` says — including the ones
 * written `HL`, `FEVER` and `FOOD POISONING`. And nothing outside `Att C` counts as MC,
 * which matters because `AFMC` rows (Air Force Medical Centre appointments) and a
 * `RETURNING FROM MC` would be wrongly swept in by a text match.
 */

import { describe, expect, test } from 'bun:test';
import {
  classify,
  DUTY_CLASS,
  extractSymptoms,
  isAbsent,
  isDuty,
  isRestricted,
  keywords,
  MC_MA,
} from '../../src/model/classify.js';

describe('MC is Att C, matched by category', () => {
  test('an Att C row is MC whatever its reason says', () => {
    ['MC', 'MC (Fever, cough)', 'HL', 'FEVER', 'FOOD POISONING', ''].forEach((reason) => {
      expect(classify({ reason_category: 'Att C', reason })).toBe(DUTY_CLASS.ATT_C);
    });
  });

  test('AFMC is a medical centre appointment, not MC', () => {
    ['AFMC', 'AFMC G1'].forEach((reason) => {
      expect(classify({ reason_category: 'Others', reason })).toBe(DUTY_CLASS.OTHERS);
    });
  });

  test('"RETURNING FROM MC" is not MC', () => {
    expect(classify({ reason_category: 'Others', reason: 'RETURNING FROM MC' })).toBe(
      DUTY_CLASS.OTHERS
    );
  });

  test('an unrecognised category surfaces as Unknown rather than vanishing', () => {
    expect(classify({ reason_category: 'Something New' })).toBe(DUTY_CLASS.UNKNOWN);
  });
});

describe('status is present, not absent', () => {
  test('Status counts as restricted, never as absence', () => {
    expect(isRestricted(DUTY_CLASS.STATUS)).toBe(true);
    expect(isAbsent(DUTY_CLASS.STATUS)).toBe(false);
  });

  test('MC, MA, Off/Leave and Others count as absence', () => {
    [DUTY_CLASS.ATT_C, DUTY_CLASS.MA, DUTY_CLASS.OFF_LEAVE, DUTY_CLASS.OTHERS].forEach((cls) => {
      expect(isAbsent(cls)).toBe(true);
    });
  });

  test('Report Sick is an event, counted as neither', () => {
    expect(isAbsent(DUTY_CLASS.REPORT_SICK)).toBe(false);
    expect(isRestricted(DUTY_CLASS.REPORT_SICK)).toBe(false);
  });
});

describe('symptom extraction', () => {
  test('reads the parade-state parenthetical', () => {
    expect(extractSymptoms('MC (Fever, cough, sore throat and runny nose)')).toEqual([
      'Sore throat',
      'Runny nose',
      'Fever',
      'Cough',
    ]);
  });

  test('reads FormSG prose just as well', () => {
    expect(extractSymptoms('Coughing & hurts to swallow')).toEqual(['Sore throat', 'Cough']);
  });

  test('a bare MC yields nothing rather than a false symptom', () => {
    expect(extractSymptoms('MC')).toEqual([]);
    expect(extractSymptoms('')).toEqual([]);
  });

  test('the RSI marker is not read as a symptom', () => {
    expect(extractSymptoms('FEVER (RSI)')).toEqual(['Fever']);
  });

  test('a specific site wins over the generic pain bucket', () => {
    expect(extractSymptoms('KNEE PAIN')).toEqual(['Knee']);
  });

  test('unspecified pain still registers when nothing else does', () => {
    expect(extractSymptoms('Inner thigh pain')).toEqual(['Hip / thigh / leg']);
    expect(extractSymptoms('body pain')).toEqual(['Pain (unspecified)']);
  });

  test('one symptom counts once however many times it is said', () => {
    expect(extractSymptoms('cough, coughing, very bad cough')).toEqual(['Cough']);
  });
});

describe('keywords for the word cloud', () => {
  test('drops stopwords, markers and short tokens', () => {
    expect(keywords('I am experiencing a very bad sore throat (RSI)')).toEqual([
      'bad',
      'sore',
      'throat',
    ]);
  });
});

describe('isDuty', () => {
  test('matches one duty class, or any of several', () => {
    expect(isDuty(DUTY_CLASS.ATT_C, DUTY_CLASS.ATT_C)).toBe(true);
    expect(isDuty(DUTY_CLASS.ATT_C, DUTY_CLASS.MA)).toBe(false);
    expect(isDuty(MC_MA, DUTY_CLASS.MA)).toBe(true);
    expect(isDuty(MC_MA, DUTY_CLASS.STATUS)).toBe(false);
  });

  test('MC / MA is Att C and MA, and never Status — status is not absence', () => {
    expect(MC_MA).toEqual([DUTY_CLASS.ATT_C, DUTY_CLASS.MA]);
    expect(MC_MA).not.toContain(DUTY_CLASS.STATUS);
  });
});
