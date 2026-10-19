/** The bridge's JSON-lines logger (no pino-pretty, so it pipes cleanly into a log file). */

import pino, { type Logger } from 'pino';

/** The few log methods the bridge calls; pino's Logger satisfies it and tests can stub it. */
export interface Log {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
  fatal(obj: unknown, msg?: string): void;
}

/** Creates the process-wide logger at a pino level such as "info". */
export function createLogger(level: string): Logger {
  return pino({ level, base: undefined, timestamp: pino.stdTimeFunctions.isoTime });
}
