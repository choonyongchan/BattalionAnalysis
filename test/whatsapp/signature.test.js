/**
 * Tests for the parade-state signature matcher.
 *
 * The positive cases in the "first parade gate" block are well-formed parade states
 * built around one header under test. The negative cases are the chatter, and the
 * last parade states, that must never reach the database.
 */

import { describe, expect, test } from 'bun:test';
import { isFirstParade, isParadeState } from '../../whatsapp/src/signature.js';

describe('isParadeState - chatter', () => {
  /** @type {Array<[string, string]>} Label and text of each rejected message. */
  const negatives = [
    ['the stated near-miss', 'Why is your parade state late?'],
    ['a greeting', 'Hi!'],
    ['an empty string', ''],
    ['whitespace only', '   \n\n  '],
    ['a chase-up with the phrase', 'Braves, please send your parade state by 0730 tomorrow. Thanks!'],
    [
      'a long chat message without the anchor',
      Array.from({ length: 20 }, (_, i) => `Line ${i}: reminder about tomorrow's admin timings and transport.`).join('\n'),
    ],
    [
      'a long message with the anchor but no structure',
      Array.from({ length: 20 }, () => 'Reminder to submit the parade state on time please.').join('\n'),
    ],
    [
      'a long first-parade reminder with no strength lines',
      [
        'Reminder: FIRST PARADE STATE is due by 0600 daily.',
        ...Array.from({ length: 10 }, (_, i) => `Point ${i}: send it to the ops group, not to me directly.`),
      ].join('\n'),
    ],
    ['a p.s. aside', 'P.S. bring water'],
    ['a terse FPS one-liner with no body', '40 SAR ARCHER COY FPS'],
    ['an fps mention mid-sentence', 'can you resend the fps for today'],
  ];

  for (const [label, text] of negatives) {
    test(`rejects ${label}`, () => {
      const result = isParadeState(text);
      expect(result.accepted).toBe(false);
      expect(result.rejectReason).toBeString();
    });
  }

  test('rejects non-string input', () => {
    expect(isParadeState(null).accepted).toBe(false);
    expect(isParadeState(undefined).accepted).toBe(false);
    expect(isParadeState(42).accepted).toBe(false);
  });
});

describe('isParadeState - verdict shape', () => {
  test('explains why a near-miss was rejected', () => {
    const result = isParadeState('Why is your parade state late?');
    expect(result.rejectReason).toContain('not a first parade state');
  });

  test('a terse FPS one-liner is rejected for bulk, not for the marker', () => {
    const result = isParadeState('40 SAR ARCHER COY FPS');
    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('too few lines');
  });
});

describe('isParadeState - first parade gate', () => {
  /**
   * Builds a well-formed parade state around a given header.
   *
   * The body carries enough strength lines and bulk to clear every other gate,
   * so the verdict turns purely on the header.
   *
   * @param {string} header The header lines under test.
   * @returns {string} A complete parade-state message.
   */
  function withHeader(header) {
    return [
      header,
      '',
      'COMPANY: 120/136',
      'PLATOON 1: 51/55',
      'PLATOON 2: 49/56',
      'COMMANDERS: 20/25',
      '[OFFICER]: 05/07',
      'CDO: 2LT TERENCE LEE',
      'CDS: 3SG KWOH KAI JIE',
      'Padding line to clear the character gate comfortably for this test case.',
    ].join('\n');
  }

  /**
   * Rewrites every present/strength pair as "present of strength", so no
   * strength line is left.
   *
   * @param {string} text A parade state.
   * @returns {string} The same text without a present/strength line.
   */
  function withoutStrengthLines(text) {
    return text.replace(/: (\d+)\/(\d+)$/gm, ': $1 of $2');
  }

  /** @type {Array<[string, string]>} Label and header of each accepted message. */
  const accepted = [
    ['FIRST PARADE STATE', '40 SAR COUGAR COMPANY\nFIRST PARADE STATE\nDATE: 220626 TIME: 0530'],
    ['a bare FIRST PARADE', 'PARADE STATE FOR 220626\nSTALLION COY FIRST PARADE'],
    ['a terse FPS with no anchor phrase', '40 SAR ARCHER COY FPS\n220626'],
    ['a lower-case fps', 'archer coy fps\n220626'],
    ['a bare FP', 'BRAVES COY\n220626 FP 0738'],
    ['FP with an afternoon timing', 'BRAVES COY FP\n1500'],
  ];

  for (const [label, header] of accepted) {
    test(`accepts ${label}`, () => {
      expect(isParadeState(withHeader(header))).toEqual({ accepted: true, rejectReason: null });
    });
  }

  /** @type {Array<[string, string, string]>} Label, header and expected reason fragment. */
  const rejected = [
    ['LAST PARADE STATE', '40 SAR BRAVES COMPANY\nLAST PARADE STATE\nDATE: 220626 TIME: 1830', 'last parade'],
    ['a terse LPS', '40 SAR BRAVES COY LPS\n220626', 'last parade'],
    ['a bare LP', 'BRAVES COY\n220626 LP 1830', 'last parade'],
    ['a header naming both parades', 'BRAVES COY FPS / LPS\n220626', 'last parade'],
    ['an unlabelled PARADE STATE with a morning timing', '40 SAR BRAVES COMPANY PARADE STATE\n220626 0738', 'not a first parade'],
    ['an unlabelled PARADE STATE with no timing', 'COUGAR COMPANY PARADE STATE\nDATE: 220626', 'not a first parade'],
    ['a bare PS', 'BRAVES COY PS\n0730', 'not a first parade'],
  ];

  for (const [label, header, reason] of rejected) {
    test(`rejects ${label}`, () => {
      const result = isParadeState(withHeader(header));
      expect(result.accepted).toBe(false);
      expect(result.rejectReason).toContain(reason);
    });
  }

  test('rejects a first parade state with no present/strength line', () => {
    const text = withoutStrengthLines(withHeader('ARCHER COY FIRST PARADE STATE'));
    expect(isParadeState(text).rejectReason).toContain('present/strength');
  });

  test('does not read a DD/MM/YY date as a strength line', () => {
    const text = withoutStrengthLines(withHeader('ARCHER COY FIRST PARADE STATE\nDATE: 22/06/26'));
    expect(isParadeState(text).rejectReason).toContain('present/strength');
  });
});

describe('first parade marker', () => {
  test('ignores an FP token that appears only below the header block', () => {
    expect(isFirstParade(['PARADE STATE', 'l2', 'l3', 'l4', 'l5', 'FP 0700'].join('\n'))).toBe(false);
  });

  test('ignores an LP token that appears only below the header block', () => {
    expect(isFirstParade(['FIRST PARADE STATE', 'l2', 'l3', 'l4', 'l5', 'LP: 2LT LEE'].join('\n'))).toBe(true);
  });

  test('does not read FP or LP inside a longer word', () => {
    expect(isFirstParade('HELP DESK FPSX\nl2')).toBe(false);
    expect(isFirstParade('ALPHA COY FPS\nl2')).toBe(true);
  });
});
