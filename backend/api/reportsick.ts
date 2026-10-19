/**
 * The FormSG report-sick webhook: one `report_sick_formsg` row per submission, through `lib/formsg/webhook.ts`.
 * `FORMSG_POST_URI` must byte-match the URL registered in FormSG.
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

/** Verifies, decrypts and stores one report-sick submission. */
export function handle(request: Request, deps: Deps): Promise<Response> {
  return handleWebhook(request, deps, FORM);
}

/**
 * The Vercel entry point, exported per method: a default export runs as a Node `(req, res)` handler
 * that never sends the returned `Response`, so the request hangs.
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
