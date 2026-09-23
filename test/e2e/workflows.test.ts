/**
 * The product's workflows end to end, over HTTP, against the Neon test branch.
 *
 * The app's three routes run on a local port (`test/support/app.ts`). Each workflow is driven by
 * the code a person's action actually runs -- the WhatsApp bridge's handler and relay, the
 * dashboard's `src/data/` calls, a real signed FormSG webhook -- and is checked by what the
 * dashboard then shows, computed by `src/model/` from the records `src/data/feed.js` loads.
 * The expected numbers are counted off the dummy data, not the code.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/index.ts';
import { loadAll } from '../../src/data/feed.js';
import { deleteMessage, depositMessage, editMessage, getMessage, listMessages } from '../../src/data/parade.js';
import { endSession, startSession } from '../../src/data/session.js';
import { DUTY_CLASS } from '../../src/model/classify.js';
import { battalionStrength, dutyCountsOn } from '../../src/model/metrics.js';
import { MESSAGE_STATUS, toMessageRows } from '../../src/model/paradeMessages.js';
import { loadConfig } from '../../whatsapp/src/config.js';
import { createMessageHandler } from '../../whatsapp/src/index.js';
import { createIngestor } from '../../whatsapp/src/ingest.js';
import { extractText, isWatchedGroupMessage } from '../../whatsapp/src/listener.js';
import { DASHBOARD_PASSWORD, INGEST_SECRET, forgetCookies, startApp, withOrigin, type RunningApp } from '../support/app.ts';
import { countRows, DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';
import { FAKE_NRIC, SICK_SPECS, webhookRequest } from '../support/formsg.ts';
import { allEntries, companyTotals, expectedKey, renderParadeState, type ParadeSpec, type Section } from '../support/paradeState.ts';
import { DOUBTFUL_EDITS, SCENARIO_DATE, SCENARIOS } from '../support/scenarios.ts';

const SPECS = SCENARIOS.map(({ spec }) => spec);
const GROUP = '120363000000000000@g.us';
const E2E_TIMEOUT_MS = DB_TIMEOUT_MS * 4;

/*
 * The browser modules are untyped JavaScript (`!Object` in JSDoc), so their answers are typed
 * loosely here; each test asserts the shape it relies on.
 */
const page = {
  deposit: (text: string): Promise<any> => depositMessage(text),
  list: (): Promise<any[]> => listMessages(),
  get: (id: number): Promise<any> => getMessage(id),
  edit: (id: number, text: string): Promise<any> => editMessage(id, text),
  remove: (id: number): Promise<any> => deleteMessage(id),
};

/**
 * Unlocks the dashboard the way the login screen does: the password once, for a session
 * cookie the jar in `withOrigin` then carries like a browser.
 *
 * @param origin The running app.
 * @param password The password to send; defaults to the right one.
 * @returns Nothing.
 */
async function unlock(origin: string, password = DASHBOARD_PASSWORD): Promise<void> {
  await withOrigin(origin, () => startSession(password));
}

/**
 * What the dashboard should show for one parade, counted off the specs filed for it.
 *
 * @param specs The parade states filed that day.
 * @returns Present and accountable strength, the companies that filed, and how many distinct
 *   soldiers each section names.
 */
function expectedDashboard(specs: ParadeSpec[]) {
  const soldiers = new Map<Section, Set<string>>();
  for (const entry of specs.flatMap(allEntries)) {
    const set = soldiers.get(entry.section) ?? new Set<string>();
    set.add(entry.fourD ?? entry.name);
    soldiers.set(entry.section, set);
  }
  return {
    accountable: specs.reduce((sum, spec) => sum + companyTotals(spec).total.strength, 0),
    present: specs.reduce((sum, spec) => sum + companyTotals(spec).total.present, 0),
    companies: specs.map((spec) => spec.company).sort(),
    bySection: Object.fromEntries([...soldiers].map(([section, set]) => [section, set.size])),
  };
}

/**
 * Reads the dashboard as a viewer would, and computes the headline numbers for one parade.
 *
 * @param origin The running app.
 * @param date The parade date.
 * @returns The loaded records and the computed figures.
 */
async function dashboardOn(origin: string, date: string) {
  const data: any = await withOrigin(origin, () => loadAll());
  const strength: any = battalionStrength(data.strength, date, 'FPS');
  const duties: any = dutyCountsOn(data.personnel, date, 'FPS');
  const bySection = Object.fromEntries(
    Object.values(DUTY_CLASS)
      .filter((dutyClass) => duties.counts[dutyClass] > 0)
      .map((dutyClass) => [dutyClass, duties.counts[dutyClass]]),
  );
  return {
    data,
    shown: { accountable: strength.accountable, present: strength.present, companies: [...strength.companiesReporting].sort(), bySection },
  };
}

/**
 * A logger that keeps what the bridge logs, so a test can read it.
 *
 * @returns The logger and what it recorded.
 */
function recordingLogger() {
  const records: Array<{ level: string; fields: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (fields: Record<string, unknown>, message: string) => {
    records.push({ level, fields, message });
  };
  return { logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') }, records };
}

/**
 * A Baileys `messages.upsert` envelope.
 *
 * @param id The WhatsApp message id.
 * @param text The message text.
 * @param options Which chat it is in, and whether the bridge itself sent it.
 * @returns The envelope.
 */
function envelope(id: string, text: string, options: { remoteJid?: string; fromMe?: boolean } = {}) {
  return {
    key: { id, remoteJid: options.remoteJid ?? GROUP, fromMe: options.fromMe ?? false },
    message: { extendedTextMessage: { text } },
  };
}

describe.skipIf(!hasTestDb)('end to end', () => {
  let db: Db;
  let app: RunningApp;
  beforeEach(async () => {
    db = await resetTestDb();
    app = startApp(db, { now: () => new Date(`${SCENARIO_DATE}T00:30:00Z`) });
    // Every test but the refusals opens the dashboard first, as a viewer does.
    forgetCookies(app.origin);
  }, DB_TIMEOUT_MS);
  afterEach(() => {
    forgetCookies(app.origin);
    app.stop();
  });

  test('WhatsApp group → bridge → intake → database → dashboard numbers', async () => {
    await unlock(app.origin);
    const config = loadConfig({ env: { WA_GROUP_ID: GROUP, PARADE_API_URL: `${app.origin}/api/parade`, PARADE_INGEST_SECRET: INGEST_SECRET } });
    const { logger, records } = recordingLogger();
    const ingestor = createIngestor({ url: config.paradeApiUrl, secret: config.ingestSecret });
    const handleMessage = createMessageHandler({ config, logger: logger as never, ingestor });

    const traffic = [
      ...SPECS.map((spec, index) => envelope(`wa-${index}`, renderParadeState(spec))),
      envelope('wa-chat', 'Morning all, reminder to bring your admin kit today.'),
      envelope('wa-other-group', renderParadeState(SPECS[0]!), { remoteJid: '999@g.us' }),
      envelope('wa-mine', renderParadeState(SPECS[0]!), { fromMe: true }),
      envelope('wa-0', renderParadeState(SPECS[0]!)), // a redelivery
    ];
    // What the listener does with each upsert.
    for (const message of traffic) {
      if (isWatchedGroupMessage(message, config.groupId)) await handleMessage(extractText(message.message)!, message);
    }

    expect(await countRows(db, 'raw_messages')).toBe(SPECS.length);
    expect(await countRows(db, 'parade_submissions')).toBe(SPECS.length);
    const outcomes = records.filter((record) => record.fields.status).map((record) => record.fields.status);
    expect(outcomes).toEqual([...SPECS.map(() => 'parsed'), 'already_parsed']);
    // The bridge logs ids and outcomes, never a name from the message.
    expect(JSON.stringify(records)).not.toContain(SPECS[1]!.units[0]!.entries[0]!.name);

    expect((await dashboardOn(app.origin, SCENARIO_DATE)).shown).toEqual(expectedDashboard(SPECS));
  }, E2E_TIMEOUT_MS);

  test('Deposit page: deposit, review, correct, move and delete, as the dashboard sees it', async () => {
    await unlock(app.origin);
    const [first, second] = [SPECS[1]!, SPECS[2]!];
    const doubtful = DOUBTFUL_EDITS[0]!.edit(renderParadeState(first));
    const moved: ParadeSpec = { ...first, date: '2026-09-19' };

    const reviewId = await withOrigin(app.origin, async () => {
      expect((await page.deposit(renderParadeState(second))).status).toBe('parsed');
      const review = await page.deposit(doubtful);
      expect(review.status).toBe('needs_review');

      const rows = toMessageRows(await page.list());
      expect(rows.map((row: any) => row.status)).toEqual([MESSAGE_STATUS.NEEDS_REVIEW, MESSAGE_STATUS.PARSED]);
      expect(rows.every((row: any) => row.source === 'Manual')).toBe(true);
      expect(rows[0]!.reasons.join(' ')).toContain('SOMETHING UNHEARD OF');
      expect((await page.get(review.id)).body).toBe(doubtful);

      // The clerk fixes the doubtful line.
      expect((await page.edit(review.id, renderParadeState(first))).status).toBe('parsed');
      expect(toMessageRows(await page.list()).map((row: any) => row.status)).toEqual([MESSAGE_STATUS.PARSED, MESSAGE_STATUS.PARSED]);
      return review.id as number;
    });
    expect((await dashboardOn(app.origin, SCENARIO_DATE)).shown).toEqual(expectedDashboard([first, second]));

    // The clerk notices it was filed under the wrong date.
    await withOrigin(app.origin, () => page.edit(reviewId, renderParadeState(moved)));
    expect((await dashboardOn(app.origin, SCENARIO_DATE)).shown).toEqual(expectedDashboard([second]));
    expect((await dashboardOn(app.origin, moved.date)).shown).toEqual(expectedDashboard([moved]));

    // And then deletes it.
    await withOrigin(app.origin, () => page.remove(reviewId));
    const after = await dashboardOn(app.origin, moved.date);
    expect(after.shown.accountable).toBe(0);
    expect(after.data.submissions.map((row: any) => row.parade_response_id)).toEqual([expectedKey(second)]);
  }, E2E_TIMEOUT_MS);

  test('FormSG webhook → database → report-sick records on the dashboard, without the NRIC', async () => {
    await unlock(app.origin);
    for (const spec of SICK_SPECS) {
      const signed = webhookRequest(spec);
      const response = await fetch(`${app.origin}/api/formsg`, { method: 'POST', headers: signed.headers, body: await signed.text() });
      expect(response.status).toBe(200);
    }

    const { data } = await dashboardOn(app.origin, SCENARIO_DATE);
    expect(data.formSg.map((row: any) => row['[Myinfo] Name']).sort()).toEqual(SICK_SPECS.map((spec) => spec.name).sort());
    expect(data.available.formSg).toBe(true);
    expect(JSON.stringify(data)).not.toContain(FAKE_NRIC);
  }, E2E_TIMEOUT_MS);

  test('a wrong password opens no session, and no session reads nothing', async () => {
    await withOrigin(app.origin, async () => {
      await expect(startSession('wrong-password')).rejects.toThrow('That password is not right.');
      // The refusal left no cookie behind, so both routes are still shut.
      await expect(loadAll()).rejects.toThrow('The session has ended. Enter the password again.');
      await expect(page.list()).rejects.toThrow();
    });
  }, E2E_TIMEOUT_MS);

  test('Lock ends the session at the server: what it opened no longer reads', async () => {
    await unlock(app.origin);
    expect((await withOrigin(app.origin, () => loadAll())) as any).toBeTruthy();
    await withOrigin(app.origin, () => endSession());
    await withOrigin(app.origin, async () => {
      await expect(loadAll()).rejects.toThrow('The session has ended. Enter the password again.');
    });
  }, E2E_TIMEOUT_MS);
});
