/**
 * Dummy FormSG report-sick submissions, encrypted and signed with the real SDK.
 *
 * The SDK's `test` mode verifies signatures against a signing key pair the SDK publishes for
 * exactly this purpose (`@opengovsg/formsg-sdk/dist/cjs/resource/signing-keys.js`), so a test
 * webhook passes the same `authenticate` and `decrypt` calls production runs, with no stub.
 *
 * NAMES ARE SYNTHETIC. `T0000001A` is NRIC-shaped on purpose: a placeholder that is not
 * NRIC-shaped would prove nothing about a pipeline whose job is to strip NRIC-shaped values.
 */
import formsgSdk from '@opengovsg/formsg-sdk';

/** The SDK's published `test`-mode signing secret. */
const TEST_SIGNING_SECRET =
  '/u+LP57Ib9y5Ytpud56FzuitSC9O6lJ4EOLOFHpsHlYpRjVdPfRqv5et5WOxLXD9zcSkOzagBJsXobd6+9pQkw==';

/** An NRIC-shaped value that must never be stored. */
export const FAKE_NRIC = 'T0000001A';

/** The URI the tests register as `FORMSG_POST_URI`. */
export const POST_URI = 'https://example.test/api/formsg';

/** A test-mode SDK that can both sign and verify webhooks. */
export const testSdk = formsgSdk({ mode: 'test', webhookSecretKey: TEST_SIGNING_SECRET });

/** One form's key pair: submissions are encrypted to the public half. */
export const FORM_KEYS = testSdk.crypto.generate();

/** The form's options for "Report Sick Type", by the enum value each maps to. */
const TYPE_OPTIONS = {
  RSI: 'Report Sick In-Camp (RSI)',
  RSO: 'Report Sick Outside (RSO)',
  MR: 'Medical Review',
  FFI: 'FFI',
} as const;

/** The form's options for the outcome, by the enum value each maps to. */
const OUTCOME_OPTIONS = { MC: 'Sick Leave / MC', Status: 'Status', Both: 'Both', None: 'None' } as const;

/** A report-sick submission, described as the answers a soldier gave. */
export interface SickSpec {
  submissionId: string;
  rank: string;
  name: string;
  fourD?: string;
  company: 'Archer' | 'Braves' | 'Cougar' | 'Stallion' | 'Hercules';
  type: keyof typeof TYPE_OPTIONS;
  /** `HH:MM`. */
  time: string;
  reason: string;
  outcome: keyof typeof OUTCOME_OPTIONS;
  mcDays?: number;
  statuses?: Array<{ status: string; days: number }>;
  /** FormSG's submission time, ISO with offset. */
  created: string;
}

/** A small table of submissions covering each report-sick type and outcome. */
export const SICK_SPECS: SickSpec[] = [
  { submissionId: 'sub-a', rank: 'REC', name: 'ALPHA TAN', fourD: '1101', company: 'Archer', type: 'RSI', time: '08:30', reason: 'Fever', outcome: 'MC', mcDays: 2, created: '2026-09-18T00:40:00.000Z' },
  { submissionId: 'sub-b', rank: 'PTE', name: 'BRAVO LIM', fourD: '2202', company: 'Braves', type: 'RSO', time: '19:10', reason: 'Sprained ankle', outcome: 'Status', statuses: [{ status: 'Excuse RMJ', days: 5 }, { status: 'Light Duty', days: 3 }], created: '2026-09-18T11:10:00.000Z' },
  { submissionId: 'sub-c', rank: 'CPL', name: 'CHARLIE ONG', company: 'Cougar', type: 'MR', time: '09:00', reason: 'Review', outcome: 'Both', mcDays: 1, statuses: [{ status: 'Excuse Heavy Load', days: 7 }], created: '2026-09-18T23:30:00.000Z' },
  { submissionId: 'sub-d', rank: 'REC', name: 'DELTA NG', fourD: '4104', company: 'Hercules', type: 'FFI', time: '07:45', reason: 'Rash', outcome: 'None', created: '2026-09-19T00:05:00.000Z' },
];

/**
 * The storage-mode answers a submission carries, including the NRIC FormSG adds.
 *
 * @param spec The submission.
 * @param extra Further answers to append, e.g. a free-text field.
 * @returns The response list, as FormSG encrypts it.
 */
export function responsesOf(spec: SickSpec, extra: Array<{ question: string; answer: string }> = []) {
  const answers: Array<[string, string]> = [
    ['Rank', spec.rank],
    ['[Myinfo] Name', spec.name],
    ['SingPass Validated NRIC', FAKE_NRIC],
    ...(spec.fourD ? ([['4D Number (REC Only)', spec.fourD]] as Array<[string, string]>) : []),
    ['Unit & Coy', `40 SAR / ${spec.company}`],
    ['Report Sick Type', TYPE_OPTIONS[spec.type]],
    ['Report Sick Time', spec.time],
    ['Reason for Reporting Sick (Keep Brief)', spec.reason],
    ['Outcome given by the doctor/MO', OUTCOME_OPTIONS[spec.outcome]],
    ...(spec.mcDays === undefined ? [] : ([['Days given for Sick Leave / MC', String(spec.mcDays)]] as Array<[string, string]>)),
    ...(spec.statuses ?? []).flatMap(({ status, days }, index): Array<[string, string]> => {
      const suffix = index === 0 ? '' : ` #${index + 1}`;
      return [
        [`Status Given${suffix}`, status],
        [`Days given for Status${suffix}`, String(days)],
      ];
    }),
    ...extra.map(({ question, answer }): [string, string] => [question, answer]),
  ];
  return answers.map(([question, answer], index) => ({ _id: `f${index}`, question, answer, fieldType: 'textfield' }));
}

/**
 * The Singapore calendar day of a UTC instant.
 *
 * @param iso An ISO timestamp.
 * @returns `yyyy-MM-dd` in Singapore time.
 */
export function sgtDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * The row a submission should become, read off the spec.
 *
 * @param spec The submission.
 * @returns The expected column values.
 */
export function expectedRow(spec: SickSpec): Record<string, unknown> {
  const statuses = Object.fromEntries(
    (spec.statuses ?? []).flatMap(({ status, days }, index) => [
      [`status${index + 1}`, status],
      [`status${index + 1}Days`, days],
    ]),
  );
  return {
    responseId: spec.submissionId,
    rank: spec.rank,
    name: spec.name,
    fourD: spec.fourD ?? null,
    unitCoy: `40 SAR / ${spec.company}`,
    company: spec.company,
    reportSickType: spec.type,
    reason: spec.reason,
    outcome: spec.outcome,
    mcDays: spec.mcDays ?? null,
    reportSickDate: sgtDay(spec.created),
    ...statuses,
  };
}

/**
 * Builds a genuinely encrypted and signed webhook request.
 *
 * @param spec The submission.
 * @param options `signedFor` signs a different URI; `extra` appends answers; `v3` encrypts in
 *   multi-respondent mode; `signature: null` leaves the header off.
 * @returns The request to hand to the route.
 */
export function webhookRequest(
  spec: SickSpec,
  options: { signedFor?: string; extra?: Array<{ question: string; answer: string }>; v3?: boolean; signature?: null; target?: string } = {},
): Request {
  const formId = 'form-test';
  let data: Record<string, unknown>;
  if (options.v3) {
    const map = Object.fromEntries(responsesOf(spec, options.extra).map(({ _id, fieldType, answer }) => [_id, { fieldType, answer }]));
    const encrypted = testSdk.cryptoV3.encrypt(map as never, FORM_KEYS.publicKey);
    data = {
      formId,
      submissionId: spec.submissionId,
      encryptedContent: encrypted.encryptedContent,
      encryptedSubmissionSecretKey: encrypted.encryptedSubmissionSecretKey,
      version: 3,
      created: spec.created,
    };
  } else {
    data = {
      formId,
      submissionId: spec.submissionId,
      encryptedContent: testSdk.crypto.encrypt(responsesOf(spec, options.extra), FORM_KEYS.publicKey),
      version: 1,
      created: spec.created,
    };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.signature !== null) {
    const epoch = Date.now();
    const signature = testSdk.webhooks.generateSignature({ uri: options.signedFor ?? POST_URI, submissionId: spec.submissionId, formId, epoch });
    headers['X-FormSG-Signature'] = testSdk.webhooks.constructHeader({ epoch, submissionId: spec.submissionId, formId, signature });
  }
  return new Request(options.target ?? POST_URI, { method: 'POST', headers, body: JSON.stringify({ data }) });
}
