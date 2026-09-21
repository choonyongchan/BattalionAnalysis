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
  toSgtDate,
  toSmallInt,
  toTime,
} from '../../lib/formsg/fields.ts';
import { mapSubmission } from '../../lib/formsg/map.ts';
import type { DecryptedSubmission } from '../../lib/formsg/map.ts';

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
      ['My symptoms are genuine and I have updated my Commander of my condition.', 'genuine'],
      ['Outcome given by the doctor/MO', 'outcome'],
      ['Days given for Sick Leave / MC', 'mcDays'],
    ];
    for (const [question, field] of titles) {
      expect(resolveField({ question })).toBe(field as never);
    }
  });

  test('matches the symptoms question whatever the underscore run length', () => {
    // The live title has a run of underscores nobody can count by eye. An off-by-one would
    // silently discard every symptom answer, so the count must not be load-bearing.
    for (const underscores of ['_', '_____', '_____________________', '______________________________']) {
      const question = `I am experiencing ${underscores} symptoms.`;
      expect(resolveField({ question })).toBe('symptoms');
    }
  });

  test('maps a numbered status question to its flat column', () => {
    expect(resolveField({ question: 'Status Given' })).toBe('status1');
    expect(resolveField({ question: 'Status Given #3' })).toBe('status3');
    expect(resolveField({ question: 'Days given for Status' })).toBe('status1Days');
    expect(resolveField({ question: 'Days given for Status #5' })).toBe('status5Days');
  });

  test('does not invent a column past status #5', () => {
    expect(resolveField({ question: 'Status Given #6' })).toBeNull();
  });

  test('recognises the NRIC and Download Status questions so they can be discarded', () => {
    expect(resolveField({ question: 'SingPass Validated NRIC' })).toBe('discard');
    expect(resolveField({ question: 'Masked NRIC' })).toBe('discard');
    expect(resolveField({ question: 'Download Status' })).toBe('discard');
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
      option: 'Others',
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

  test('gives the Singapore-local date, which runs 8 hours ahead of UTC', () => {
    expect(toSgtDate('2026-09-18T23:30:00.000Z')).toBe('2026-09-19');
    expect(toSgtDate('2026-09-18T08:31:00.000+08:00')).toBe('2026-09-18');
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
    const { row } = mapSubmission(
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
      }));

    expect(row).toMatchObject({
      responseId: '6800000000000000000000a1',
      rank: 'REC',
      name: 'TAN AH KOW',
      nameKey: 'TAN AH KOW',
      timestamp: '2026-09-20T10:15:00.000+08:00',
      fourD: 'a1105',
      unitCoy: '40 SAR / Archer',
      reportSickType: 'RSO',
      reportSickTime: '14:00',
      reason: 'sore throat',
      symptoms: 'Upper Respiratory Tract Infection (Fever/Flu etc.)',
      genuine: true,
      outcome: 'MC',
      mcDays: 2,
      company: 'Archer',
      reportSickDate: '2026-09-20',
      symptomCategory: 'Upper Respiratory Tract Infection (Fever/Flu etc.)',
      symptomOtherText: null,
    });
  });

  test('folds battalion HQ into Hercules', () => {
    const { row } = mapSubmission(
      submission({ 'Unit & Coy': '40 SAR / Hercules & Bn HQ' }));
    expect(row.company).toBe('Hercules');
  });

  test('never carries an NRIC onto the row, however it arrives', () => {
    const { row } = mapSubmission(
      submission({
        '[Myinfo] Name': 'TAN AH KOW',
        'SingPass Validated NRIC': 'T0000001A',
        'Masked NRIC': '001A',
      }));
    expect(JSON.stringify(row)).not.toContain('T0000001A');
    expect(JSON.stringify(row)).not.toContain('001A');
    expect(Object.keys(row)).not.toContain('nric');
  });

  test('does not warn about the NRIC questions, which are discarded on purpose', () => {
    const { unmapped } = mapSubmission(
      submission({ 'SingPass Validated NRIC': 'T0000001A', 'Download Status': 'Success' }));
    expect(unmapped).toEqual([]);
  });

  test('reports a question it does not recognise instead of dropping it silently', () => {
    const { unmapped } = mapSubmission(
      submission({ 'A question added last week': 'some answer' }));
    expect(unmapped).toEqual(['A question added last week']);
  });

  test('splits an Others symptom into category and free text, keeping the raw answer', () => {
    const { row } = mapSubmission(
      submission({ 'I am experiencing _____________________ symptoms.': 'Others: back pain' }),
    );
    expect(row.symptoms).toBe('Others: back pain');
    expect(row.symptomCategory).toBe('Others');
    expect(row.symptomOtherText).toBe('back pain');
  });

  test('fills the flat status columns in place', () => {
    const { row } = mapSubmission(
      submission({
        'Status Given': 'Light Duty',
        'Days given for Status': '2',
        'Status Given #3': 'Excuse RMJ',
        'Days given for Status #3': '7 days',
      }),
    );
    expect(row).toMatchObject({
      status1: 'Light Duty',
      status1Days: 2,
      status3: 'Excuse RMJ',
      status3Days: 7,
    });
    expect(row.status2).toBeUndefined();
  });

  test('reports an answer whose option it does not recognise', () => {
    /*
     * The day someone edits "Report Sick In-Camp (RSI)" in the FormSG editor, the question
     * still resolves, the answer still arrives, and the column silently goes null on every
     * submission from then on. Nothing else in the pipeline would notice, so the mapper says
     * so and the route logs it.
     */
    const { row, unrecognised } = mapSubmission(
      submission({
        'Report Sick Type': 'Report Sick In Camp',
        'Outcome given by the doctor/MO': 'Referred onward',
      }));

    expect(row.reportSickType).toBeNull();
    expect(unrecognised).toEqual([
      'reportSickType=Report Sick In Camp',
      'outcome=Referred onward',
    ]);
  });

  test('does not report an unanswered optional question as unrecognised', () => {
    // Most submissions predate the outcome section entirely. A null from a blank answer is
    // normal, and reporting it would bury the signal from a renamed option.
    const { unrecognised } = mapSubmission(
      submission({ Rank: 'REC', 'Report Sick Type': '' }));
    expect(unrecognised).toEqual([]);
  });

  test('reports nothing for a submission whose options all resolve', () => {
    const { unrecognised } = mapSubmission(
      submission({
        'Report Sick Type': 'Report Sick Outside (RSO)',
        'Outcome given by the doctor/MO': 'Sick Leave / MC',
      }));
    expect(unrecognised).toEqual([]);
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
    const { row } = mapSubmission(decrypted);
    // Degrades to a longer string rather than discarding all but one selection.
    expect(row.symptoms).toContain('Gastrointestinal');
    expect(row.symptoms).toContain('cramps');
  });
});
