/**
 * How stored parade-state messages read on the Deposit page.
 */
import { describe, expect, test } from 'bun:test';
import {
  MESSAGE_STATUS,
  describeOutcome,
  reasonsOf,
  receivedInSgt,
  sourceOf,
  statusOf,
  toMessageRows,
} from '../../src/model/paradeMessages.js';

describe('sourceOf', () => {
  test('tells a dashboard deposit from a WhatsApp message', () => {
    expect(sourceOf('manual:ab12')).toBe('Manual');
    expect(sourceOf('3EB0C1D2E3')).toBe('WhatsApp');
  });
});

describe('statusOf', () => {
  test.each([
    [{ paradeResponseId: 'Archer_2026-09-18_FPS', error: null, processedAt: 't' }, MESSAGE_STATUS.PARSED],
    [{ paradeResponseId: null, error: 'Needs review: bad line', processedAt: 't' }, MESSAGE_STATUS.NEEDS_REVIEW],
    [{ paradeResponseId: null, error: 'This is a LAST PARADE STATE.', processedAt: 't' }, MESSAGE_STATUS.REJECTED],
    [{ paradeResponseId: null, error: null, processedAt: null }, MESSAGE_STATUS.PENDING],
  ])('%o is %s', (message, status) => {
    expect(statusOf(message)).toBe(status);
  });
});

describe('reasonsOf', () => {
  test('splits parser doubts into one reason per line', () => {
    expect(reasonsOf('Needs review: first | second')).toEqual(['first', 'second']);
  });

  test('keeps a rejection whole, and has nothing for a parsed message', () => {
    expect(reasonsOf('Not a parade state.')).toEqual(['Not a parade state.']);
    expect(reasonsOf(null)).toEqual([]);
  });
});

describe('receivedInSgt', () => {
  test('reads a UTC timestamp as a Singapore date and time, across midnight', () => {
    expect(receivedInSgt('2026-09-17T23:31:00Z')).toEqual({ date: '2026-09-18', time: '07:31' });
  });

  test('is null for an unreadable timestamp', () => {
    expect(receivedInSgt('not a time')).toBeNull();
  });
});

describe('toMessageRows', () => {
  test('shapes a summary for the table', () => {
    const [row] = toMessageRows([
      {
        id: 4,
        waMessageId: 'manual:ab',
        receivedAt: '2026-09-17T23:31:00Z',
        processedAt: '2026-09-17T23:31:01Z',
        paradeResponseId: 'Archer_2026-09-18_FPS',
        error: null,
      },
    ]);
    expect(row).toEqual({
      id: 4,
      parade: 'Archer · 2026-09-18 · FPS',
      status: MESSAGE_STATUS.PARSED,
      source: 'Manual',
      received: { date: '2026-09-18', time: '07:31' },
      reasons: [],
    });
  });
});

describe('describeOutcome', () => {
  test('reports a parse with its key and personnel count', () => {
    expect(
      describeOutcome({ status: 'parsed', paradeResponseId: 'Archer_2026-09-18_FPS', counts: { personnel: 1 } }),
    ).toEqual({ tone: 'good', text: 'Saved Archer · 2026-09-18 · FPS: 1 personnel line.', reasons: [] });
  });

  test('lists what to correct when the parser was unsure', () => {
    const said = describeOutcome({ status: 'needs_review', problems: ['a', 'b'] });
    expect(said.tone).toBe('error');
    expect(said.reasons).toEqual(['a', 'b']);
  });

  test('gives the reason for a rejection', () => {
    expect(describeOutcome({ status: 'rejected', reason: 'Not a parade state.' }).reasons).toEqual(['Not a parade state.']);
  });
});
