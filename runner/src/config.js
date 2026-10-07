/**
 * Environment-backed configuration for the WhatsApp bridge.
 *
 * Every secret and deployment-specific value lives in the repo-root
 * .env.whatsapp, loaded by `bun --env-file=.env.whatsapp` (the `whatsapp`
 * package script). It is separate from .env.local because the bridge holds no
 * database credentials at all: it only relays text to `api/parade.ts`.
 * Started without that file, the required variables read as missing and
 * `loadConfig` says so by name rather than failing later and vaguely.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {string} Absolute path to the whatsapp/ module root. */
export const MODULE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @type {string} Directory holding the persisted Baileys auth session. */
export const AUTH_DIR = join(MODULE_ROOT, 'auth');

/**
 * Reads a required environment variable.
 *
 * @param {!Object<string, string>} env The environment to read from.
 * @param {string} key Name of the variable.
 * @returns {string} The trimmed value.
 * @throws {Error} If the variable is missing or blank.
 */
function requireEnv(env, key) {
  const value = (env[key] || '').trim();
  if (value.length === 0) {
    throw new Error(`Missing required environment variable ${key}. Copy .env.whatsapp.example to .env.whatsapp, fill it in, and start with \`bun run whatsapp\`.`);
  }
  return value;
}

/**
 * Reads an optional environment variable.
 *
 * @param {!Object<string, string>} env The environment to read from.
 * @param {string} key Name of the variable.
 * @param {string} fallback Value to use when the variable is absent or blank.
 * @returns {string} The trimmed value, or the fallback.
 */
function optionalEnv(env, key, fallback) {
  const value = (env[key] || '').trim();
  return value.length === 0 ? fallback : value;
}

/**
 * Builds the whole configuration, validating it up front.
 *
 * Loading fails fast at start-up rather than at the moment the first parade
 * state arrives.
 *
 * `env` is injectable because Bun has already merged .env.whatsapp into `process.env`
 * before this module runs, which a test cannot undo — without it, a populated
 * .env.whatsapp on the developer's machine silently overrides whatever the test set.
 *
 * `WA_GROUP_ID` may be blank only under `DRY_RUN=1`: the listener then accepts
 * every chat, which is how the group's JID is discovered (README step 3), and a
 * live run must never store parade states from the wrong chat.
 *
 * @param {{env?: !Object<string, string>}} [options] `env` defaults to
 *   process.env, which already carries .env.whatsapp.
 * @returns {{groupId: string, paradeApiUrl: string, ingestSecret: string,
 *   logLevel: string, dryRun: boolean, authDir: string}} The resolved configuration.
 * @throws {Error} If a required variable is missing or a value is malformed.
 */
export function loadConfig(options = {}) {
  const env = options.env || process.env;
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
