/**
 * Tests for the supervisor's restart-decision helpers.
 *
 * The spawn/restart loop itself starts real child processes, so it is exercised
 * by hand (see whatsapp/README.md); these cover the pure functions that decide
 * how long to wait and whether to restart at all.
 */

import { describe, expect, test } from 'bun:test';
import { computeBackoffMs, isCleanExit, nextRestartCount } from '../../whatsapp/src/supervisor.js';

describe('computeBackoffMs', () => {
  test('grows with each consecutive restart', () => {
    expect(computeBackoffMs(1)).toBe(3000);
    expect(computeBackoffMs(2)).toBe(15000);
    expect(computeBackoffMs(3)).toBe(60000);
  });

  test('clamps past the last step', () => {
    expect(computeBackoffMs(4)).toBe(60000);
    expect(computeBackoffMs(99)).toBe(60000);
  });
});

describe('nextRestartCount', () => {
  test('increments for a quick crash', () => {
    expect(nextRestartCount(2, 10_000)).toBe(3);
  });

  test('resets after a long stable run', () => {
    expect(nextRestartCount(3, 400_000)).toBe(1);
  });
});

describe('isCleanExit', () => {
  test('a normal exit is clean', () => {
    expect(isCleanExit(0, null)).toBe(true);
  });

  test('exit code 3 (re-pair required) is clean - do not restart', () => {
    expect(isCleanExit(3, null)).toBe(true);
  });

  test('a crash exit is not clean', () => {
    expect(isCleanExit(1, null)).toBe(false);
  });

  test('a signal kill is never clean, whatever the code', () => {
    expect(isCleanExit(0, 'SIGKILL')).toBe(false);
  });
});
