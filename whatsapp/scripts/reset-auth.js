/**
 * Wipes the persisted Baileys session so the next `bun run whatsapp` pairs afresh.
 *
 * The listener never does this on its own: a misclassified `badSession` would
 * force an avoidable QR re-pair. When the session really is dead - repeated
 * "Bad MAC", a reconnect loop, or the "session is dead" message - run this, then
 * `bun run whatsapp` and scan the QR again.
 */

import { rmSync } from 'node:fs';
import { AUTH_DIR } from '../src/config.js';

/**
 * Deletes the auth directory and prints the next step.
 *
 * @returns {void}
 */
function resetAuth() {
  rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log(`auth wiped (${AUTH_DIR}) - run \`bun run whatsapp\` and scan the QR code.`);
}

if (import.meta.main) {
  resetAuth();
}
