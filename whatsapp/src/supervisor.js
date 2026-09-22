/**
 * Keeps the WhatsApp bridge running.
 *
 * The bridge (`src/index.js`) is a plain long-lived process: a crash just ends
 * it. This supervisor spawns it as a child, forwards its output, and restarts it
 * on a crash up to MAX_RESTARTS times in a row, with a growing backoff between
 * attempts. After the cap it prints a loud banner and exits non-zero, leaving an
 * OS-level relauncher (a `shell:startup` shortcut, or Task Scheduler with
 * "restart on failure") to bring the whole thing back.
 *
 * It is deliberately thin: it does not load config or talk to WhatsApp. A
 * missing environment variable, a dead session, everything of that kind surfaces
 * from the child with its own actionable message.
 */

import { join } from 'node:path';
import { createLogger } from './logger.js';

/** @type {string} Absolute path to the bridge entry point. */
const BRIDGE_ENTRY = join(import.meta.dir, 'index.js');

/**
 * @type {string} Working directory for the child (the module root). Not the repo
 * root: Bun auto-loads .env.local from the child's cwd, which would leak the
 * owner's secrets into the bridge. whatsapp/ holds no env file.
 */
const MODULE_ROOT = join(import.meta.dir, '..');

/** @type {number} Consecutive crash-restarts before the supervisor gives up. */
const MAX_RESTARTS = 3;

/** @type {number[]} Delay before restart 1, 2, 3 - indexed by consecutive count. */
const BACKOFF_MS = [3000, 15000, 60000];

/**
 * @type {number} A child that ran at least this long before crashing is treated
 * as a fresh incident: the restart counter resets, so a bridge that is healthy
 * for hours and then crashes once still gets the full three attempts.
 */
const STABLE_RUNTIME_MS = 300000;

/** @type {number} Grace period after forwarding a stop signal before SIGKILL. */
const SHUTDOWN_GRACE_MS = 10000;

/**
 * @type {Set<number>} Child exit codes that mean "do not restart": 0 is a clean
 * shutdown, 3 is the bridge signalling a dead session that needs a manual
 * re-pair (see src/index.js).
 */
const CLEAN_EXIT_CODES = new Set([0, 3]);

/**
 * Spawns the bridge as a child process.
 *
 * @returns {{proc: Object, startedAt: number}} The subprocess and the epoch ms
 *   it was started.
 */
function startChild() {
  // execPath, not 'bun': a scheduled task's PATH may not include ~/.bun/bin.
  const proc = Bun.spawn([process.execPath, BRIDGE_ENTRY], {
    cwd: MODULE_ROOT,
    env: process.env,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return { proc, startedAt: Date.now() };
}

/**
 * Backoff before the nth consecutive restart.
 *
 * @param {number} consecutiveRestarts 1-based count of the restart about to run.
 * @returns {number} Milliseconds to wait, clamped to the last BACKOFF_MS entry.
 */
export function computeBackoffMs(consecutiveRestarts) {
  const index = Math.min(consecutiveRestarts, BACKOFF_MS.length) - 1;
  return BACKOFF_MS[index];
}

/**
 * The restart counter after a crash: reset to 1 when the child had been running
 * long enough to count as stable, otherwise one more than before.
 *
 * @param {number} prevCount The counter before this crash.
 * @param {number} ranMs How long the crashed child ran, in ms.
 * @returns {number} The new counter.
 */
export function nextRestartCount(prevCount, ranMs) {
  return ranMs >= STABLE_RUNTIME_MS ? 1 : prevCount + 1;
}

/**
 * Reports whether a child exit should stop the supervisor rather than restart.
 *
 * @param {?number} exitCode The child's exit code.
 * @param {?string} signalCode The signal that killed the child, if any.
 * @returns {boolean} True when the exit is clean and no restart is wanted.
 */
export function isCleanExit(exitCode, signalCode) {
  return signalCode == null && CLEAN_EXIT_CODES.has(exitCode);
}

/**
 * Pauses for the given duration.
 *
 * @param {number} ms Milliseconds to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Emits an unmissable banner line so a give-up stands out in the log.
 *
 * @param {import('pino').Logger} logger The supervisor logger.
 * @param {string} message The message to frame.
 * @returns {void}
 */
function logLoudly(logger, message) {
  const rule = '='.repeat(72);
  logger.fatal(rule);
  logger.fatal(message);
  logger.fatal(rule);
}

/**
 * Registers SIGINT/SIGTERM handlers that stop the supervision loop and forward
 * the signal to the running child.
 *
 * @param {function(): ?Object} getChild Returns the current subprocess, or null.
 * @param {function(): void} markShuttingDown Sets the loop's shutdown flag.
 * @returns {void}
 */
function installSignalForwarding(getChild, markShuttingDown) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      markShuttingDown();
      const child = getChild();
      if (!child) {
        return;
      }
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

/**
 * Runs the supervision loop until the child exits cleanly, the supervisor is
 * signalled to stop, or the restart cap is hit.
 *
 * @returns {Promise<number>} The exit code the supervisor process should use.
 */
export async function runSupervisor() {
  const logger = createLogger(process.env.LOG_LEVEL || 'info').child({ component: 'supervisor' });

  let child = null;
  let shuttingDown = false;
  installSignalForwarding(
    () => child,
    () => {
      shuttingDown = true;
    }
  );

  let restarts = 0;
  logger.info({ entry: BRIDGE_ENTRY }, 'starting the WhatsApp bridge under supervision');

  for (;;) {
    const { proc, startedAt } = startChild();
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
      return exitCode;
    }

    restarts = nextRestartCount(restarts, ranMs);

    if (restarts > MAX_RESTARTS) {
      logLoudly(
        logger,
        `giving up after ${MAX_RESTARTS} consecutive restarts ` +
          `(last exit code=${exitCode} signal=${signalCode}). Fix the error above, then \`bun run whatsapp\`.`
      );
      return 1;
    }

    const delay = computeBackoffMs(restarts);
    logger.warn(
      { restarts, max: MAX_RESTARTS, exitCode, signalCode, ranMs },
      `bridge crashed; restart ${restarts}/${MAX_RESTARTS} in ${delay}ms`
    );
    await sleep(delay);
  }
}

if (import.meta.main) {
  runSupervisor().then((code) => process.exit(code));
}
