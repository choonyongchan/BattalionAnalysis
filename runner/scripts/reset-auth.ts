/** Wipes the persisted Baileys session so the next `bun run runner` pairs afresh (for a really dead session). */

import { rmSync } from 'node:fs';
import { AUTH_DIR } from '../src/config.ts';

if (import.meta.main) {
  rmSync(AUTH_DIR, { recursive: true, force: true });
  console.log(`auth wiped (${AUTH_DIR}) - run \`bun run runner\` and scan the QR code.`);
}
