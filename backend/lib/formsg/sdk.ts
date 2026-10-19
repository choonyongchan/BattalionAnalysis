/** The FormSG SDK, loaded the one way that survives Vercel's bundler. */
import { createRequire } from 'node:module';

/** The parts of `formsg()` the webhook routes use. */
export interface FormSgSdk {
  webhooks: { authenticate(header: string, uri: string): boolean };
  crypto: any;
  cryptoV3: any;
}

/**
 * Loads the FormSG SDK through CommonJS: its ESM build fails to load under Node on Vercel. Named `require`
 * on purpose, since Vercel bundles only a literal `require('<name>')`; an inline call would be left out.
 */
const require = createRequire(import.meta.url);

/** `formsg()`, typed to what the routes use. */
export const formsgSdk = require('@opengovsg/formsg-sdk') as (config: { mode: string }) => FormSgSdk;
