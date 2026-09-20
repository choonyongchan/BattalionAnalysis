/**
 * FormSG field resolution and row mapping.
 *
 * Every question title and every categorical value used here is copied from a real export
 * of 2,376 responses. The point of that is not realism for its own sake: the mapping is
 * matched against these exact strings at runtime, so a test written from memory would pass
 * while production silently dropped the field.
 *
 * Names are synthetic. No real submission content appears in this file.
 */
import { describe, expect, test } from 'bun:test';
import {
  resolveField,
  splitOtherOption,
  toBoolean,
  toOutcome,
  toReportSickType,
  toSmallInt,
  toTime,
} from '../../lib/formsg/fields.ts';
import { mapSubmission } from '../../lib/formsg/map.ts';
import type { DecryptedSubmission } from '../../lib/formsg/map.ts';

const SYMPTOM_IDS = new Map<string, number>([
  ['Upper Respiratory Tract Infection (Fever/Flu etc.)', 1],
  ['Gastrointestinal (Diarrhoea, Vomiting, Nausea)', 4],
]);

describe('resolveField', () => {
  test('recognises every question title in the live form', () => {
    const titles: Array<[string, string]> = [
      ['Rank', 'rank'],
      ['[Myinfo] Name', 'name'],
      ['4D Number (REC Only)', 'fourD'],
      ['Unit & Coy', 'unitCoy'],
      ['Report Sick Time', 'reportSickTime'],
      ['Report Sick Type', 'reportSickType'],
      ['Reason for Reporting Sick (Keep Brief)', 'reason'],
      ['My symptoms are genuine and I have updated my Commander of my condition.', 'declarationGenuine'],
      ['Outcome given by the doctor/MO', 'outcome'],
      ['Days given for Sick Leave / MC', 'mcDays'],
    ];
    for (const [question, field] of titles) {
      expect(resolveField({ question })?.field).toBe(field as never);
    }
  });

  test('matches the symptoms question whatever the underscore run length', () => {
    // The live title has a run of underscores nobody can count by eye. An off-by-one would
    // silently discard every symptom answer, so the count must not be load-bearing.
    for (const underscores of ['_', '_____', '_____________________', '______________________________']) {
      const question = `I am experiencing ${underscores} symptoms.`;
      expect(resolveField({ question })?.field).toBe('symptoms');
    }
  });

  test('recovers the repetition index from a numbered status question', () => {
    expect(resolveField({ question: 'Status Given' })).toEqual({ field: 'statusGiven', index: 1 });
    expect(resolveField({ question: 'Status Given #3' })).toEqual({ field: 'statusGiven', index: 3 });
    expect(resolveField({ question: 'Days given for Status #5' })).toEqual({
      field: 'statusDays',
      index: 5,
    });
  });

  test('recognises the NRIC questions so they can be discarded on purpose', () => {
    expect(resolveField({ question: 'SingPass Validated NRIC' })?.field).toBe('discard');
    expect(resolveField({ question: 'Masked NRIC' })?.field).toBe('discard');
  });

  test('returns null for a question it has never seen', () => {
    expect(resolveField({ question: 'Some brand new question' })).toBeNull();
  });
});

describe('value parsing', () => {
  test('maps the four report-sick options onto the shared enum', () => {
    expect(toReportSickType('Report Sick In-Camp (RSI)')).toBe('RSI');
    expect(toReportSickType('Report Sick Outside (RSO)')).toBe('RSO');
    expect(toReportSickType('Medical Review')).toBe('MR');
    expect(toReportSickType('FFI')).toBe('FFI');
  });

  test('returns null for an unrecognised report-sick option rather than guessing', () => {
    expect(toReportSickType('Something else')).toBeNull();
    expect(toReportSickType('')).toBeNull();
  });

  test('maps the four outcome options', () => {
    expect(toOutcome('Sick Leave / MC')).toBe('MC');
    expect(toOutcome('Status (e.g Excuse..., Rest In Bunk)')).toBe('Status');
    expect(toOutcome('Both Sick Leave & Status')).toBe('Both');
    expect(toOutcome('None')).toBe('None');
  });

  test('survives an edit to the long outcome option text', () => {
    // That option contains an ellipsis and has been edited once already.
    expect(toOutcome('Status (e.g. Excuse RMJ, Light Duty)')).toBe('Status');
  });

  test('splits an Others answer from a canonical option', () => {
    expect(splitOtherOption('Others: persistent cough')).toEqual({
      option: null,
      otherText: 'persistent cough',
    });
    expect(splitOtherOption('Chest Pain & Shortness of Breath')).toEqual({
      option: 'Chest Pain & Shortness of Breath',
      otherText: null,
    });
    expect(splitOtherOption('')).toEqual({ option: null, otherText: null });
  });

  test('parses the attestation', () => {
    expect(toBoolean('Yes')).toBe(true);
    expect(toBoolean('No')).toBe(false);
    expect(toBoolean('')).toBeNull();
  });

  test('parses a day count even when the respondent types a unit', () => {
    expect(toSmallInt('3')).toBe(3);
    expect(toSmallInt('3 days')).toBe(3);
    expect(toSmallInt('')).toBeNull();
    expect(toSmallInt('none')).toBeNull();
  });

  test('parses an HHMM report-sick time', () => {
    expect(toTime('1400')).toBe('14:00');
    expect(toTime('09:30')).toBe('09:30');
    expect(toTime('0930')).toBe('09:30');
  });

  test('rejects an impossible time rather than storing it', () => {
    expect(toTime('2599')).toBeNull();
    expect(toTime('7')).toBeNull();
    expect(toTime('')).toBeNull();
  });
});

/**
 * Builds a decrypted submission from question/answer pairs.
 *
 * @param answers Question title to answer text.
 * @returns A submission shaped as the webhook delivers it.
 */
function submission(answers: Record<string, string>): DecryptedSubmission {
  return {
    submissionId: '6800000000000000000000a1',
    formId: 'form-1',
    submittedAt: '2026-09-20T10:15:00.000+08:00',
    responses: Object.entries(answers).map(([question, answer]) => ({ question, answer })),
  };
}

describe('mapSubmission', () => {
  test('maps a complete submission, including the September outcome fields', () => {
    const { submission: row } = mapSubmission(
      submission({
        Rank: 'REC',
        '[Myinfo] Name': 'TAN AH KOW',
        '4D Number (REC Only)': 'a1105',
        'Unit & Coy': '40 SAR / Archer',
        'Report Sick Time': '1400',
        'Report Sick Type': 'Report Sick Outside (RSO)',
        'Reason for Reporting Sick (Keep Brief)': 'sore throat',
        'I am experiencing _____________________ symptoms.':
          'Upper Respiratory Tract Infection (Fever/Flu etc.)',
        'My symptoms are genuine and I have updated my Commander of my condition.': 'Yes',
        'Outcome given by the doctor/MO': 'Sick Leave / MC',
        'Days given for Sick Leave / MC': '2',
      }),
      SYMPTOM_IDS,
    );

    expect(row).toMatchObject({
      responseId: '6800000000000000000000a1',
      rank: 'REC',
      name: 'TAN AH KOW',
      nameKey: 'TAN AH KOW',
      fourD: 'a1105',
      fourDNormalised: 'A1105',
      company: 'Archer',
      reportSickType: 'RSO',
      reportSickTime: '14:00',
      reason: 'sore throat',
      symptomCategoryId: 1,
      symptomOtherText: null,
      attestedGenuine: true,
      outcome: 'MC',
      mcDays: 2,
    });
  });

  test('folds battalion HQ into Hercules', () => {
    const { submission: row } = mapSubmission(
      submission({ 'Unit & Coy': '40 SAR / Hercules & Bn HQ' }),
      SYMPTOM_IDS,
    );
    expect(row.company).toBe('Hercules');
  });

  test('never carries an NRIC onto the row, however it arrives', () => {
    const { submission: row } = mapSubmission(
      submission({
        '[Myinfo] Name': 'TAN AH KOW',
        'SingPass Validated NRIC': 'T0000001A',
        'Masked NRIC': '001A',
      }),
      SYMPTOM_IDS,
    );
    expect(JSON.stringify(row)).not.toContain('T0000001A');
    expect(JSON.stringify(row)).not.toContain('001A');
    expect(Object.keys(row)).not.toContain('nric');
  });

  test('does not warn about the NRIC questions, which are discarded on purpose', () => {
    const { unmapped } = mapSubmission(
      submission({ 'SingPass Validated NRIC': 'T0000001A', 'Download Status': 'Success' }),
      SYMPTOM_IDS,
    );
    expect(unmapped).toEqual([]);
  });

  test('reports a question it does not recognise instead of dropping it silently', () => {
    const { unmapped } = mapSubmission(
      submission({ 'A question added last week': 'some answer' }),
      SYMPTOM_IDS,
    );
    expect(unmapped).toEqual(['A question added last week']);
  });

  test('keeps an Others symptom as free text', () => {
    const { submission: row } = mapSubmission(
      submission({ 'I am experiencing _____________________ symptoms.': 'Others: back pain' }),
      SYMPTOM_IDS,
    );
    expect(row.symptomCategoryId).toBeNull();
    expect(row.symptomOtherText).toBe('back pain');
  });

  test('keeps a newly added form option as text rather than losing it', () => {
    // A tenth option added to the form would otherwise map to null and vanish.
    const { submission: row } = mapSubmission(
      submission({ 'I am experiencing _____________________ symptoms.': 'Dental (Toothache)' }),
      SYMPTOM_IDS,
    );
    expect(row.symptomCategoryId).toBeNull();
    expect(row.symptomOtherText).toBe('Dental (Toothache)');
  });

  test('turns the repeated status questions into child rows', () => {
    const { statuses } = mapSubmission(
      submission({
        'Status Given': 'Light Duty',
        'Days given for Status': '2',
        'Status Given #2': 'Excuse Stay In',
        'Days given for Status #2': '7',
      }),
      SYMPTOM_IDS,
    );
    expect(statuses).toEqual([
      { responseId: '6800000000000000000000a1', seq: 1, statusLabel: 'Light Duty', days: 2 },
      { responseId: '6800000000000000000000a1', seq: 2, statusLabel: 'Excuse Stay In', days: 7 },
    ]);
  });

  test('renumbers sequentially when the form skips an index', () => {
    const { statuses } = mapSubmission(
      submission({ 'Status Given': 'Light Duty', 'Status Given #3': 'Excuse RMJ' }),
      SYMPTOM_IDS,
    );
    expect(statuses.map((s) => s.seq)).toEqual([1, 2]);
    expect(statuses.map((s) => s.statusLabel)).toEqual(['Light Duty', 'Excuse RMJ']);
  });

  test('produces no status rows for the great majority that have none', () => {
    const { statuses } = mapSubmission(submission({ Rank: 'REC' }), SYMPTOM_IDS);
    expect(statuses).toEqual([]);
  });

  test('handles a checkbox-shaped answer, in case the form is ever switched', () => {
    const decrypted: DecryptedSubmission = {
      submissionId: 'x',
      submittedAt: '2026-09-20T10:15:00.000+08:00',
      responses: [
        {
          question: 'I am experiencing _____________________ symptoms.',
          answerArray: ['Gastrointestinal (Diarrhoea, Vomiting, Nausea)', 'Others: cramps'],
        },
      ],
    };
    const { submission: row } = mapSubmission(decrypted, SYMPTOM_IDS);
    // Degrades to a longer string rather than discarding all but one selection.
    expect(row.symptomOtherText).toContain('Gastrointestinal');
  });
});
