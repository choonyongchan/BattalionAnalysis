/**
 * Tests for FormSG's structured clinical pick-list and its free-text reason field.
 *
 * The case worth having is the collision the pick-list invites: an `Others: <text>`
 * answer must land in the 'Other' bucket even when its text happens to name a symptom
 * that has its own clean bucket ("Others: Cough" is not URTI), because the soldier chose
 * not to pick the URTI option and the chart should say so.
 */

import { describe, expect, test } from 'bun:test';
import { clinicalBucketOf, CLINICAL_BUCKETS, reasonKeywords } from '../../src/model/symptoms.js';

const URTI = 'Upper Respiratory Tract Infection (Fever/Flu etc.)';
const FEVER_HEADACHE = 'Fever / Headache (High Temp, Severe Migraine etc.)';
const MUSCULOSKELETAL = 'Musculoskeletal (Pain/Sprain/Strain/Numbness of Arm, Leg, Ankle etc)';
const GASTROINTESTINAL = 'Gastrointestinal (Diarrhoea, Vomiting, Nausea)';
const DERMATOLOGY = 'Dermatology Related (Skin Rashes/Abrasion/Eczema/Burns and Cuts)';
const CHEST_PAIN = 'Chest Pain & Shortness of Breath';
const EYE_SIGHT = 'Eye & Sight Related (Conjunctivitis/Soreness in Eye etc.)';
const MENTAL_WELLNESS = 'Psychiatric / Mental Wellness (Stress/Anxiety/Insomnia etc.)';

describe('CLINICAL_BUCKETS', () => {
  test('lists all eight verbatim labels in the documented order', () => {
    expect(CLINICAL_BUCKETS).toEqual([
      URTI,
      FEVER_HEADACHE,
      MUSCULOSKELETAL,
      GASTROINTESTINAL,
      DERMATOLOGY,
      CHEST_PAIN,
      EYE_SIGHT,
      MENTAL_WELLNESS,
    ]);
  });
});

describe('clinicalBucketOf', () => {
  test('each of the eight verbatim answers maps to itself exactly', () => {
    CLINICAL_BUCKETS.forEach((bucket) => {
      expect(clinicalBucketOf(bucket)).toBe(bucket);
    });
  });

  test('an "Others: <text>" answer becomes Other, not confused with a matching bucket', () => {
    expect(clinicalBucketOf('Others: Cough')).toBe('Other');
    expect(clinicalBucketOf('Others: NIL')).toBe('Other');
    expect(clinicalBucketOf('Others: Toothache')).toBe('Other');
  });

  test('a blank answer becomes Unstated, distinct from Other', () => {
    expect(clinicalBucketOf('')).toBe('Unstated');
    expect(clinicalBucketOf(null)).toBe('Unstated');
  });
});

describe('reasonKeywords', () => {
  test('excludes markers and stopwords from the free-text reason field', () => {
    const submissions = [
      { reason: 'MC RSI sore throat and cough' },
      { reason: 'Att C sore throat again' },
    ];
    const words = reasonKeywords(submissions, 10).map((entry) => entry.word);
    expect(words).toContain('sore');
    expect(words).toContain('throat');
    expect(words).not.toContain('mc');
    expect(words).not.toContain('rsi');
    expect(words).not.toContain('att');
  });

  test('reads the reason only, so the pick-list wording cannot flood the cloud', () => {
    // Every URTI submission carries the same seventy-character option text. Counting it
    // would put "upper", "respiratory" and "tract" at the top of every cloud the form
    // has ever produced, and say nothing.
    const submissions = [
      { reason: 'blocked nose', symptomAnswer: URTI },
      { reason: 'blocked nose', symptomAnswer: URTI },
    ];
    const words = reasonKeywords(submissions, 10).map((entry) => entry.word);
    expect(words).toContain('blocked');
    expect(words).not.toContain('respiratory');
  });
});
