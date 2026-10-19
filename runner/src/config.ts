/** Configuration for the WhatsApp bridge, read from the repo-root `.env.whatsapp` (no database credentials). */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Absolute path to `runner/`. */
export const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directory holding the persisted Baileys session. */
export const AUTH_DIR = join(MODULE_ROOT, 'auth');

/** The bridge's resolved configuration. */
export interface Config {
  groupId: string;
  paradeApiUrl: string;
  ingestSecret: string;
  logLevel: string;
  dryRun: boolean;
  authDir: string;
}

type Env = Record<string, string | undefined>;

/** A required variable, trimmed; throws naming it when missing. */
function requireEnv(env: Env, key: string): string {
  const value = (env[key] ?? '').trim();
  if (value === '') {
    throw new Error(
      `Missing required environment variable ${key}. Copy .env.whatsapp.example to .env.whatsapp, fill it in, and start with \`bun run runner\`.`,
    );
  }
  return value;
}

/** An optional variable, trimmed, or the fallback when blank. */
function optionalEnv(env: Env, key: string, fallback: string): string {
  const value = (env[key] ?? '').trim();
  return value === '' ? fallback : value;
}

/**
 * Validates the configuration at start-up. `env` is injectable because Bun merges `.env.whatsapp`
 * into `process.env` before tests run. `WA_GROUP_ID` may be blank only under `DRY_RUN=1` (to discover it).
 */
export function loadConfig({ env = process.env }: { env?: Env } = {}): Config {
  const dryRun = optionalEnv(env, 'DRY_RUN', '0') === '1';
  return {
    groupId: dryRun ? optionalEnv(env, 'WA_GROUP_ID', '') : requireEnv(env, 'WA_GROUP_ID'),
    paradeApiUrl: requireEnv(env, 'PARADE_API_URL'),
    ingestSecret: requireEnv(env, 'PARADE_INGEST_SECRET'),
    logLevel: optionalEnv(env, 'LOG_LEVEL', 'info'),
    dryRun,
    authDir: AUTH_DIR,
  };
}
