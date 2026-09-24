/**
 * The FormSG Self-Regulated Fitness Training webhook: one row into `sft_formsg` per submission.
 *
 * The verify → decrypt → map → insert flow is `lib/formsg/webhook.ts`, shared with
 * `api/reportsick.ts`. SFT is its own form with its own key; `FORMSG_SFT_POST_URI` must
 * byte-match the URL registered in FormSG (`…/api/sft`).
 */
import { getDb } from '../db/index.ts';
import { sftFormsg } from '../db/schema.ts';
import { formsgSdk } from '../lib/formsg/sdk.ts';
import { mapSftSubmission } from '../lib/formsg/sft.ts';
import { handleWebhook, type Deps, type FormSpec } from '../lib/formsg/webhook.ts';

export type { Deps };

/** The SFT form. */
const FORM: FormSpec = {
  table: sftFormsg,
  map: mapSftSubmission,
  tag: 'api/sft',
  secretKeyVar: 'FORMSG_SFT_SECRET_KEY',
  postUriVar: 'FORMSG_SFT_POST_URI',
};

/**
 * Verifies, decrypts and stores one SFT submission.
 *
 * @param request The incoming request.
 * @param deps Database handle, secrets and the SDK.
 * @returns The webhook's response.
 */
export function handle(request: Request, deps: Deps): Promise<Response> {
  return handleWebhook(request, deps, FORM);
}

/**
 * The Vercel entry point, exported per method (see `api/reportsick.ts`).
 *
 * @param request The incoming request.
 * @returns The response.
 */
function route(request: Request): Promise<Response> {
  return handle(request, {
    db: getDb(),
    secretKey: process.env.FORMSG_SFT_SECRET_KEY,
    postUri: process.env.FORMSG_SFT_POST_URI,
    sdk: formsgSdk({ mode: 'production' }),
  });
}

export { route as POST };
