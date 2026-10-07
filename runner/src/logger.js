/**
 * Shared structured logger.
 *
 * Pretty-printing is deliberately avoided so the bridge has no dependency on
 * pino-pretty; the JSON lines are readable enough in a terminal and pipe
 * cleanly into a file when the bridge is run as a startup task.
 */

import pino from 'pino';

/**
 * Creates the process-wide logger.
 *
 * @param {string} level Pino level name, e.g. "info" or "debug".
 * @returns {import('pino').Logger} The configured logger.
 */
export function createLogger(level) {
  return pino({ level, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });
}
