/**
 * The whole API on http://localhost:3001 over the test branch, filled with synthetic data, so
 * `bun run dev` shows a working dashboard with no production access.
 *
 * Every name is synthetic. The test branch is emptied first, exactly as the test suite does.
 *
 * Usage: `bun run dev:api` (env from `.env.test`), then `bun run dev` and log in with
 * `DASHBOARD_PASSWORD` or `SETTINGS_PASSWORD` from `test/support/app.ts`.
 */
import { ingestMessage } from '../../backend/lib/pipeline.ts';
import { handle as handleReportSick } from '../../backend/api/reportsick.ts';
import { handle as handleSft } from '../../backend/api/sft.ts';
import { startApp, sftDeps } from './app.ts';
import { resetTestDb } from './db.ts';
import { FORM_KEYS, POST_URI, SFT_SPECS, SICK_SPECS, sftWebhookRequest, testSdk, webhookRequest } from './formsg.ts';
import { renderParadeState, shiftIso } from './paradeState.ts';
import { COMPANY_NAMES, prng, randomSpec } from './scenarios.ts';

process.env.SESSION_SECRET ??= 'dev-session-secret';

/** How many days of history to make, ending today. */
const DAYS = 28;

/** Today in Singapore, `yyyy-MM-dd`. */
const TODAY = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

const db = await resetTestDb();
const random = prng(40);
let seed = 1;

for (let back = DAYS - 1; back >= 0; back--) {
  const date = shiftIso(TODAY, -back);
  // Most companies file most days; a missing filing is part of what the dashboard shows.
  for (const company of COMPANY_NAMES) {
    if (random() < 0.12) continue;
    const spec = randomSpec(seed++, { company, date });
    await ingestMessage(db, { waMessageId: `dev-${company}-${date}`, body: renderParadeState(spec) }, new Date(`${date}T00:30:00Z`));
  }
  // A handful of report-sick and SFT submissions a day, cycled from the fixture specs.
  for (let n = 0; n < 2 + Math.floor(random() * 5); n++) {
    const base = SICK_SPECS[n % SICK_SPECS.length]!;
    const hour = String(Math.floor(random() * 24)).padStart(2, '0');
    const spec = { ...base, submissionId: `dev-sick-${date}-${n}`, company: COMPANY_NAMES[n % 5]!, created: `${date}T${hour}:15:00.000Z` };
    await handleReportSick(webhookRequest(spec), { db, secretKey: FORM_KEYS.secretKey, postUri: POST_URI, sdk: testSdk });
  }
  for (let n = 0; n < Math.floor(random() * 4); n++) {
    const base = SFT_SPECS[n % SFT_SPECS.length]!;
    const spec = { ...base, submissionId: `dev-sft-${date}-${n}`, created: `${date}T10:${String(n * 7).padStart(2, '0')}:00.000Z` };
    await handleSft(sftWebhookRequest(spec), sftDeps(db));
  }
}

const app = startApp(db, { port: 3001 });
console.log(`API with ${DAYS} days of synthetic data at ${app.origin}. Run \`bun run dev\` next.`);
