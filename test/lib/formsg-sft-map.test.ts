/**
 * The SFT mapper, over the live form's question titles. NAMES ARE SYNTHETIC.
 */
import { describe, expect, test } from 'bun:test';
import { mapSftSubmission, resolveSftField } from '../../lib/formsg/sft.ts';
import { expectedSftRow, SFT_SPECS, sftResponsesOf } from '../support/formsg.ts';

/**
 * Wraps answers as a decrypted submission.
 *
 * @param spec The submission spec.
 * @param responses The answers.
 * @returns The submission.
 */
function decrypted(spec: (typeof SFT_SPECS)[number], responses = sftResponsesOf(spec)) {
  return { submissionId: spec.submissionId, submittedAt: spec.created, responses };
}

describe('mapSftSubmission', () => {
  test.each(SFT_SPECS.map((spec) => [spec.submissionId, spec] as const))('%s maps every answered column', (_id, spec) => {
    const mapped = mapSftSubmission(decrypted(spec));
    expect(mapped.row).toMatchObject(expectedSftRow(spec));
    expect(mapped.unmapped).toEqual([]);
    expect(mapped.unrecognised).toEqual([]);
  });

  test('Download Status is known but not stored', () => {
    const row = mapSftSubmission(decrypted(SFT_SPECS[0]!)).row;
    expect(JSON.stringify(row)).not.toContain('Downloaded');
  });

  test('the SGT date is used, so an evening session is not filed under the UTC day', () => {
    const spec = { ...SFT_SPECS[0]!, created: '2026-09-18T17:30:00.000Z' };
    expect(mapSftSubmission(decrypted(spec)).row.sftDate).toBe('2026-09-19');
  });

  test('a new question is reported as unmapped', () => {
    const spec = SFT_SPECS[0]!;
    const mapped = mapSftSubmission(decrypted(spec, sftResponsesOf(spec, [{ question: 'Buddy name', answer: 'x' }])));
    expect(mapped.unmapped).toEqual(['Buddy name']);
  });

  test('a company answer naming no company is kept raw and reported', () => {
    const spec = SFT_SPECS[0]!;
    const responses = sftResponsesOf(spec).map((r) => (r.question === 'Company' ? { ...r, answer: 'Bn HQ' } : r));
    const mapped = mapSftSubmission(decrypted(spec, responses));
    expect(mapped.row).toMatchObject({ unitCoy: 'Bn HQ', company: null });
    expect(mapped.unrecognised).toEqual(['company=Bn HQ']);
  });

  test('an unticked acknowledgement is false', () => {
    const spec = SFT_SPECS[0]!;
    const responses = sftResponsesOf(spec).map((r) =>
      r.question.startsWith('I have informed') ? { ...r, answerArray: [] } : r,
    );
    expect(mapSftSubmission(decrypted(spec, responses)).row.informedCommander).toBe(false);
  });
});

describe('resolveSftField', () => {
  test('a reworded acknowledgement tail still maps', () => {
    expect(resolveSftField({ question: 'My training is between 0700h and 2200h, and I have no IPPT tomorrow.' })).toBe('windowConfirmed');
  });
});
