/**
 * Tests for the supervisor's restart-decision helpers.
 *
 * The loop runs against fake children, so no real process is spawned and no
 * backoff is waited out. The real signal handlers are left untested: installing
 * them would leak process listeners into the rest of the run.
 */

import { describe, expect, mock, test } from 'bun:test';
import { computeBackoffMs, isCleanExit, nextRestartCount, runSupervisor } from '../../runner/src/supervisor.js';

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

/**
 * Builds a spawner whose children exit with the given results, in order.
 *
 * @param {Array<{exitCode: ?number, signalCode?: ?string, ranMs?: number}>} exits
 *   One entry per child: how it exits and how long it ran.
 * @returns {Function} The spawner, a mock so its calls can be counted.
 */
function fakeSpawner(exits) {
  let index = 0;
  return mock(() => {
    const { exitCode, signalCode = null, ranMs = 1_000 } = exits[index++];
    const proc = { pid: index, exited: Promise.resolve(exitCode), signalCode, kill: mock() };
    return { proc, startedAt: Date.now() - ranMs };
  });
}

/**
 * Runs the supervisor against fake collaborators.
 *
 * @param {Function} spawnChild The fake spawner.
 * @param {Function=} onStopSignal The fake signal installer.
 * @returns {Promise<{code: number, wait: Function, logger: Object}>} The exit code
 *   and the fakes, for assertions.
 */
async function supervise(spawnChild, onStopSignal = () => {}) {
  const wait = mock(async () => {});
  const logger = { info: mock(), warn: mock(), fatal: mock() };
  const code = await runSupervisor({ spawnChild, wait, onStopSignal, logger });
  return { code, wait, logger };
}

describe('runSupervisor', () => {
  test.each([0, 3])('stops without a restart when the bridge exits %i', async (exitCode) => {
    const spawn = fakeSpawner([{ exitCode }]);
    const { code, wait } = await supervise(spawn);

    expect(code).toBe(exitCode);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  test('restarts a crashed bridge after a backoff', async () => {
    const spawn = fakeSpawner([{ exitCode: 1 }, { exitCode: 0 }]);
    const { code, wait } = await supervise(spawn);

    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(wait.mock.calls).toEqual([[3000]]);
  });

  test('restarts a bridge killed by a signal, even with exit code 0', async () => {
    const spawn = fakeSpawner([{ exitCode: 0, signalCode: 'SIGKILL' }, { exitCode: 0 }]);
    const { code } = await supervise(spawn);

    expect(code).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test('gives up with exit code 1 after three quick crashes in a row', async () => {
    const spawn = fakeSpawner(Array.from({ length: 4 }, () => ({ exitCode: 1 })));
    const { code, wait, logger } = await supervise(spawn);

    expect(code).toBe(1);
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls).toEqual([[3000], [15000], [60000]]);
    expect(logger.fatal.mock.calls[1][0]).toContain('giving up after 3 consecutive restarts');
  });

  test('a long stable run resets the restart count', async () => {
    const spawn = fakeSpawner([
      { exitCode: 1 },
      { exitCode: 1 },
      { exitCode: 1, ranMs: 600_000 },
      { exitCode: 1 },
      { exitCode: 0 },
    ]);
    const { code, wait } = await supervise(spawn);

    expect(code).toBe(0);
    expect(wait.mock.calls).toEqual([[3000], [15000], [3000], [15000]]);
  });

  test.each([
    [130, 130],
    [null, 0],
  ])('stops on a signal instead of restarting (child exit %p -> %p)', async (exitCode, expected) => {
    let resolveExit;
    const proc = { pid: 1, exited: new Promise((resolve) => (resolveExit = resolve)), signalCode: 'SIGINT' };
    const spawn = mock(() => ({ proc, startedAt: Date.now() }));
    let signal;
    const running = supervise(spawn, (getChild, markShuttingDown) => {
      signal = { getChild, markShuttingDown };
    });
    await Promise.resolve();

    expect(signal.getChild()).toBe(proc);
    signal.markShuttingDown();
    resolveExit(exitCode);
    const { code, wait } = await running;

    expect(code).toBe(expected);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(signal.getChild()).toBeNull();
  });
});
