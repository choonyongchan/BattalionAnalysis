/**
 * Keeps the bridge (`index.ts`) running: restarts a crashed child up to MAX_RESTARTS times with backoff,
 * then exits non-zero for the OS-level relauncher (`runner:service`).
 */

import { join } from 'node:path';
import type { Subprocess } from 'bun';
import { createLogger, type Log } from './logger.ts';

/** The bridge entry point. */
const BRIDGE_ENTRY = join(import.meta.dir, 'index.ts');

/** The child's cwd: `runner/`, not the repo root, so Bun does not auto-load the owner's `.env.local`. */
const MODULE_ROOT = join(import.meta.dir, '..');

/** Consecutive crash-restarts before giving up. */
const MAX_RESTARTS = 3;

/** Delay before restart 1, 2, 3. */
const BACKOFF_MS = [3000, 15000, 60000];

/** A child that ran this long before crashing counts as a fresh incident. */
const STABLE_RUNTIME_MS = 300000;

/** Grace after forwarding a stop signal before SIGKILL. */
const SHUTDOWN_GRACE_MS = 10000;

/** Exit codes that mean "do not restart": 0 clean, 3 dead session needing a re-pair. */
const CLEAN_EXIT_CODES = new Set([0, 3]);

/** A running bridge and when it started. */
export interface Child {
  proc: Pick<Subprocess, 'pid' | 'exited' | 'signalCode' | 'kill'>;
  startedAt: number;
}

/** Spawns the bridge with this Bun (a scheduled task's PATH may lack `bun`). */
function startChild(): Child {
  const proc = Bun.spawn([process.execPath, BRIDGE_ENTRY], {
    cwd: MODULE_ROOT,
    env: process.env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return { proc, startedAt: Date.now() };
}

/** Backoff before the nth consecutive restart, clamped to the last entry. */
export function computeBackoffMs(consecutiveRestarts: number): number {
  return BACKOFF_MS[Math.min(consecutiveRestarts, BACKOFF_MS.length) - 1]!;
}

/** The restart counter after a crash: back to 1 after a stable run, else one more. */
export function nextRestartCount(prevCount: number, ranMs: number): number {
  return ranMs >= STABLE_RUNTIME_MS ? 1 : prevCount + 1;
}

/** Whether a child exit should stop the supervisor rather than restart it. */
export function isCleanExit(exitCode: number | null, signalCode: string | null | undefined): boolean {
  return signalCode == null && exitCode !== null && CLEAN_EXIT_CODES.has(exitCode);
}

/** Pauses for `ms`. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Logs a framed banner so a give-up stands out. */
function logLoudly(logger: Pick<Log, 'fatal'>, message: string): void {
  const rule = '='.repeat(72);
  logger.fatal(rule);
  logger.fatal(message);
  logger.fatal(rule);
}

/** On SIGINT/SIGTERM: stop the loop and forward the signal to the child, then SIGKILL after a grace period. */
function installSignalForwarding(getChild: () => Child['proc'] | null, markShuttingDown: () => void): void {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      markShuttingDown();
      const child = getChild();
      if (!child) return;
      child.kill(signal);
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }, SHUTDOWN_GRACE_MS);
    });
  }
}

/** Supervises until a clean exit, a stop signal or the restart cap; resolves with the exit code to use. */
export async function runSupervisor({
  spawnChild = startChild,
  wait = sleep,
  onStopSignal = installSignalForwarding,
  logger = createLogger(process.env.LOG_LEVEL || 'info').child({ component: 'supervisor' }),
}: {
  spawnChild?: () => Child;
  wait?: (ms: number) => Promise<void>;
  onStopSignal?: (getChild: () => Child['proc'] | null, markShuttingDown: () => void) => void;
  logger?: Pick<Log, 'info' | 'warn' | 'fatal'>;
} = {}): Promise<number> {
  let child: Child['proc'] | null = null;
  let shuttingDown = false;
  onStopSignal(
    () => child,
    () => {
      shuttingDown = true;
    },
  );

  let restarts = 0;
  logger.info({ entry: BRIDGE_ENTRY }, 'starting the WhatsApp bridge under supervision');

  for (;;) {
    const { proc, startedAt } = spawnChild();
    child = proc;
    logger.info({ pid: proc.pid }, 'bridge started');

    const exitCode = await proc.exited;
    const signalCode = proc.signalCode;
    const ranMs = Date.now() - startedAt;
    child = null;

    if (shuttingDown) {
      logger.info({ exitCode, signalCode }, 'supervisor stopping on signal');
      return exitCode ?? 0;
    }
    if (isCleanExit(exitCode, signalCode)) {
      logger.info({ exitCode }, 'bridge exited cleanly; not restarting');
      return exitCode ?? 0;
    }

    restarts = nextRestartCount(restarts, ranMs);
    if (restarts > MAX_RESTARTS) {
      logLoudly(
        logger,
        `giving up after ${MAX_RESTARTS} consecutive restarts ` +
          `(last exit code=${exitCode} signal=${signalCode}). Fix the error above, then \`bun run runner\`.`,
      );
      return 1;
    }

    const delay = computeBackoffMs(restarts);
    logger.warn({ restarts, max: MAX_RESTARTS, exitCode, signalCode, ranMs }, `bridge crashed; restart ${restarts}/${MAX_RESTARTS} in ${delay}ms`);
    await wait(delay);
  }
}

if (import.meta.main) {
  runSupervisor().then((code) => process.exit(code));
}
