/** The FormSG SDK, loaded the one way that survives Vercel's bundler. */
import { createRequire } from 'node:module';

/** The parts of `formsg()` the webhook routes use. */
export interface FormSgSdk {
  webhooks: { authenticate(header: string, uri: string): boolean };
  crypto: any;
  cryptoV3: any;
}

/**
 * Loads the FormSG SDK through CommonJS.
 *
 * `@opengovsg/formsg-sdk@8` points its `import` condition at `dist/esm/index.js` but ships no
 * `"type": "module"` beside it, so Node parses that file as CommonJS and the function dies at
 * module load with `SyntaxError: Cannot use import statement outside a module`. Its `require`
 * condition resolves to `cjs-entry.cjs`, a real `.cjs` file that loads cleanly; the package's
 * `exports` map blocks importing that path directly, so it has to be reached via `require`.
 *
 * Bun loads the ESM build leniently, which is why the tests never saw this.
 *
 * The handle is named `require` on purpose: Vercel traces a function's dependencies statically,
 * and it only recognises `require('<literal>')`. Calling `createRequire(...)(...)` inline reads
 * as dynamic, so the package is left out of the bundle and the function fails at runtime with
 * `Cannot find module '@opengovsg/formsg-sdk'`.
 */
const require = createRequire(import.meta.url);

/** `formsg()`, typed to what the routes use. */
export const formsgSdk = require('@opengovsg/formsg-sdk') as (config: { mode: string }) => FormSgSdk;
