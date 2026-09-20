/**
 * Tests for cell coercion.
 *
 * The cases worth having are the ones that would otherwise fail silently: a date read a
 * day out because the viewer is west of Singapore, and a blank strength cell summed as
 * zero rather than reported as unstated.
 */

import { describe, expect, test } from 'bun:test';
import { toIsoDate, toNumber, toText, toTimeOfDay } from '../../src/model/values.js';

describe('dates', () => {
  test('an ISO string is read as written', () => {
    expect(toIsoDate('2026-06-22')).toBe('2026-06-22');
  });

  test('a Sheets serial number is read as the same calendar date', () => {
    expect(toIsoDate(46195)).toBe('2026-06-22');
  });

  test('a serial with a time fraction keeps its date', () => {
    expect(toIsoDate(46195.75)).toBe('2026-06-22');
  });

  test('an ISO date-time keeps its leading date', () => {
    expect(toIsoDate('2026-06-22T19:21:00')).toBe('2026-06-22');
  });

  test('a blank or unparseable cell is null, not today', () => {
    expect(toIsoDate('')).toBeNull();
    expect(toIsoDate('not a date')).toBeNull();
  });
});

describe('time of day', () => {
  test('an ISO date-time yields the time it states', () => {
    expect(toTimeOfDay('2026-06-22T09:05:00')).toEqual({ hour: 9, minute: 5, minutes: 545 });
  });

  test('a space-separated date-time reads the same as the T form', () => {
    expect(toTimeOfDay('2026-06-22 09:05:00')).toEqual({ hour: 9, minute: 5, minutes: 545 });
  });

  test("a serial's fraction is the time of day", () => {
    expect(toTimeOfDay(46195.5)).toEqual({ hour: 12, minute: 0, minutes: 720 });
  });

  test('a date with no time is null, not midnight', () => {
    expect(toTimeOfDay('2026-06-22')).toBeNull();
    expect(toTimeOfDay('')).toBeNull();
  });
});

describe('numbers and text', () => {
  test('a blank strength cell is null, not zero', () => {
    expect(toNumber('')).toBeNull();
    expect(toNumber(null)).toBeNull();
    expect(toNumber('not a number')).toBeNull();
  });

  test('numbers survive as numbers whether stored as text or not', () => {
    expect(toNumber(136)).toBe(136);
    expect(toNumber('136')).toBe(136);
  });

  test('text is trimmed and blank-ish values collapse to an empty string', () => {
    expect(toText('  Cougar ')).toBe('Cougar');
    expect(toText(null)).toBe('');
  });
});
