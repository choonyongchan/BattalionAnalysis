/** Tests for the supervisor's restart-decision helpers. */

import { describe, expect, mock, test } from 'bun:test';
import { computeBackoffMs, isCleanExit, nextRestartCount, runSupervisor, type Child } from '../../runner/src/supervisor.ts';

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

/** How one fake child exits, and how long it ran. */
type Exit = { exitCode: number | null; signalCode?: NodeJS.Signals | null; ranMs?: number };

/** A spawner (a mock, so calls can be counted) whose children exit as listed, in order. */
function fakeSpawner(exits: Exit[]) {
  let index = 0;
  return mock((): Child => {
    const { exitCode, signalCode = null, ranMs = 1_000 } = exits[index++]!;
    const proc = { pid: index, exited: Promise.resolve(exitCode), signalCode, kill: mock() } as unknown as Child['proc'];
    return { proc, startedAt: Date.now() - ranMs };
  });
}

type StopSignal = NonNullable<Parameters<typeof runSupervisor>[0]>['onStopSignal'];

/** Runs the supervisor against fake collaborators; returns its exit code and the fakes. */
async function supervise(spawnChild: () => Child, onStopSignal: StopSignal = () => {}) {
  const wait = mock(async (_ms: number) => {});
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
    expect(logger.fatal.mock.calls[1]?.[0]).toContain('giving up after 3 consecutive restarts');
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
    let resolveExit: (code: number | null) => void = () => {};
    const exited = new Promise<number | null>((resolve) => (resolveExit = resolve));
    const proc = { pid: 1, exited, signalCode: 'SIGINT' } as unknown as Child['proc'];
    const spawn = mock(() => ({ proc, startedAt: Date.now() }));
    let getChild: () => Child['proc'] | null = () => null;
    let markShuttingDown = () => {};
    const running = supervise(spawn, (get, mark) => {
      getChild = get;
      markShuttingDown = mark;
    });
    await Promise.resolve();

    expect(getChild()).toBe(proc);
    markShuttingDown();
    resolveExit(exitCode);
    const { code, wait } = await running;

    expect(code).toBe(expected);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(getChild()).toBeNull();
  });
});
