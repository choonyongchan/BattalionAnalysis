/**
 * The FormSG report-sick webhook: one row into `report_sick_formsg` per submission.
 *
 * The verify → decrypt → map → insert flow is `lib/formsg/webhook.ts`, shared with `api/sft.ts`.
 * `FORMSG_POST_URI` must byte-match the URL registered in FormSG (`…/api/reportsick`).
 */
import { getDb } from '../db/index.ts';
import { reportSickFormsg } from '../db/schema.ts';
import { mapSubmission } from '../lib/formsg/map.ts';
import { formsgSdk } from '../lib/formsg/sdk.ts';
import { handleWebhook, type Deps, type FormSpec } from '../lib/formsg/webhook.ts';

export type { Deps };

/** The report-sick form. */
const FORM: FormSpec = {
  table: reportSickFormsg,
  map: mapSubmission,
  tag: 'api/reportsick',
  secretKeyVar: 'FORMSG_SECRET_KEY',
  postUriVar: 'FORMSG_POST_URI',
};

/**
 * Verifies, decrypts and stores one report-sick submission.
 *
 * @param request The incoming request.
 * @param deps Database handle, secrets and the SDK.
 * @returns The webhook's response.
 */
export function handle(request: Request, deps: Deps): Promise<Response> {
  return handleWebhook(request, deps, FORM);
}

/**
 * The Vercel entry point.
 *
 * Exported per HTTP method, not as `default`: Vercel runs a default-exported function as a
 * Node `(req, res)` handler, which never sends the returned `Response`, so the request hangs.
 *
 * @param request The incoming request.
 * @returns The response.
 */
function route(request: Request): Promise<Response> {
  return handle(request, {
    db: getDb(),
    secretKey: process.env.FORMSG_SECRET_KEY,
    postUri: process.env.FORMSG_POST_URI,
    sdk: formsgSdk({ mode: 'production' }),
  });
}

export { route as POST };
