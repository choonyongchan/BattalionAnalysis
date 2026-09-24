/**
 * Dummy FormSG report-sick and SFT submissions, encrypted and signed with the real SDK.
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
export const POST_URI = 'https://example.test/api/reportsick';

/** The URI the tests register as `FORMSG_SFT_POST_URI`. */
export const SFT_POST_URI = 'https://example.test/api/sft';

/** A test-mode SDK that can both sign and verify webhooks. */
export const testSdk = formsgSdk({ mode: 'test', webhookSecretKey: TEST_SIGNING_SECRET });

/** One form's key pair: submissions are encrypted to the public half. */
export const FORM_KEYS = testSdk.crypto.generate();

/** The SFT form's key pair: a separate form, so a separate key. */
export const SFT_FORM_KEYS = testSdk.crypto.generate();

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

/** Options every signed webhook takes. */
export interface WebhookOptions {
  /** Signs a different URI than the one registered. */
  signedFor?: string;
  /** Answers to append. */
  extra?: Array<{ question: string; answer: string }>;
  /** Encrypts in multi-respondent mode. */
  v3?: boolean;
  /** `null` leaves the signature header off. */
  signature?: null;
  /** The URL the request is addressed to. */
  target?: string;
}

/** One storage-mode answer, as FormSG encrypts it. */
type Answer = { _id: string; question: string; answer?: string; answerArray?: string[]; fieldType: string };

/**
 * Builds a genuinely encrypted and signed webhook request for any form.
 *
 * @param submission The submission id, FormSG's `created`, and the answers.
 * @param form The form's registered post URI and public key.
 * @param options See `WebhookOptions`.
 * @returns The request to hand to the route.
 */
function signedRequest(
  submission: { submissionId: string; created: string; responses: Answer[] },
  form: { postUri: string; publicKey: string },
  options: WebhookOptions,
): Request {
  const formId = 'form-test';
  const { submissionId, created, responses } = submission;
  let data: Record<string, unknown>;
  if (options.v3) {
    const map = Object.fromEntries(
      responses.map(({ _id, fieldType, answer, answerArray }) => [_id, { fieldType, answer: answer ?? answerArray }]),
    );
    const encrypted = testSdk.cryptoV3.encrypt(map as never, form.publicKey);
    data = {
      formId,
      submissionId,
      encryptedContent: encrypted.encryptedContent,
      encryptedSubmissionSecretKey: encrypted.encryptedSubmissionSecretKey,
      version: 3,
      created,
    };
  } else {
    data = { formId, submissionId, encryptedContent: testSdk.crypto.encrypt(responses as never, form.publicKey), version: 1, created };
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.signature !== null) {
    const epoch = Date.now();
    const signature = testSdk.webhooks.generateSignature({ uri: options.signedFor ?? form.postUri, submissionId, formId, epoch });
    headers['X-FormSG-Signature'] = testSdk.webhooks.constructHeader({ epoch, submissionId, formId, signature });
  }
  return new Request(options.target ?? form.postUri, { method: 'POST', headers, body: JSON.stringify({ data }) });
}

/**
 * Builds a genuinely encrypted and signed report-sick webhook request.
 *
 * @param spec The submission.
 * @param options See `WebhookOptions`.
 * @returns The request to hand to the route.
 */
export function webhookRequest(spec: SickSpec, options: WebhookOptions = {}): Request {
  const responses = responsesOf(spec, options.extra);
  return signedRequest({ ...spec, responses }, { postUri: POST_URI, publicKey: FORM_KEYS.publicKey }, options);
}

/** An SFT submission, described as the answers a soldier gave. */
export interface SftSpec {
  submissionId: string;
  rank: string;
  name: string;
  company: 'Archer' | 'Braves' | 'Cougar' | 'Stallion' | 'Hercules';
  groupIc: string;
  pes: string;
  exercises: string[];
  sfabt: string;
  location: string;
  /** FormSG's submission time, ISO with offset. */
  created: string;
}

/** SFT sessions: on the 18th, one IC spelt three ways leads three soldiers and a second IC one; the 19th has one. */
export const SFT_SPECS: SftSpec[] = [
  { submissionId: 'sft-a', rank: 'PTE', name: 'ECHO TAN', company: 'Archer', groupIc: '3SG FOXTROT LIM', pes: 'A', exercises: ['Run', 'Push-ups'], sfabt: 'N/A', location: 'Camp Stadium', created: '2026-09-18T10:00:00.000Z' },
  { submissionId: 'sft-b', rank: 'LCP', name: 'GOLF ONG', company: 'Archer', groupIc: 'Foxtrot Lim', pes: 'B1', exercises: ['Run'], sfabt: 'N/A', location: 'camp stadium', created: '2026-09-18T10:05:00.000Z' },
  { submissionId: 'sft-c', rank: 'REC', name: 'HOTEL NG', company: 'Braves', groupIc: '3SG FOXTROT LIMM', pes: 'A', exercises: ['Run', 'Sit-ups'], sfabt: 'N/A', location: 'Camp Stadium', created: '2026-09-18T10:10:00.000Z' },
  { submissionId: 'sft-d', rank: 'PTE', name: 'INDIA KOH', company: 'Braves', groupIc: 'LTA JULIET WEE', pes: 'C9L1', exercises: ['Swim'], sfabt: 'Upper body', location: 'Camp Pool', created: '2026-09-18T11:00:00.000Z' },
  { submissionId: 'sft-e', rank: 'PTE', name: 'ECHO TAN', company: 'Archer', groupIc: '3SG FOXTROT LIM', pes: 'A', exercises: ['Run'], sfabt: 'N/A', location: 'Camp Stadium', created: '2026-09-19T10:00:00.000Z' },
];

/**
 * The storage-mode answers an SFT submission carries, in the live form's question order.
 *
 * @param spec The submission.
 * @param extra Further answers to append.
 * @returns The response list, as FormSG encrypts it.
 */
export function sftResponsesOf(spec: SftSpec, extra: Array<{ question: string; answer: string }> = []): Answer[] {
  const answers: Array<Omit<Answer, '_id'>> = [
    { question: 'Download Status', answer: 'Downloaded', fieldType: 'textfield' },
    { question: 'Rank', answer: spec.rank, fieldType: 'dropdown' },
    { question: '[Myinfo] Name', answer: spec.name, fieldType: 'textfield' },
    { question: 'Company', answer: `40 SAR / ${spec.company}`, fieldType: 'dropdown' },
    { question: 'Rank & Name of Group IC', answer: spec.groupIc, fieldType: 'textfield' },
    { question: 'PES Status', answer: spec.pes, fieldType: 'dropdown' },
    { question: 'I have informed my commander of my SFT.', answerArray: ['Yes'], fieldType: 'checkbox' },
    { question: 'What exercise will you be doing?', answerArray: spec.exercises, fieldType: 'checkbox' },
    { question: 'Type of Service-Fit Ability Based Training (SFABT)', answer: spec.sfabt, fieldType: 'dropdown' },
    {
      question: 'My training is between 0700h and 2200h. Also, if I am training tonight, I do not have IPPT/VOC tests tomorrow.',
      answerArray: ['Yes'],
      fieldType: 'checkbox',
    },
    { question: 'Training Location', answer: spec.location, fieldType: 'textfield' },
    ...extra.map(({ question, answer }) => ({ question, answer, fieldType: 'textfield' })),
  ];
  return answers.map((answer, index) => ({ _id: `s${index}`, ...answer }));
}

/**
 * The row an SFT submission should become, read off the spec.
 *
 * @param spec The submission.
 * @returns The expected column values.
 */
export function expectedSftRow(spec: SftSpec): Record<string, unknown> {
  return {
    responseId: spec.submissionId,
    rank: spec.rank,
    name: spec.name,
    nameKey: spec.name,
    unitCoy: `40 SAR / ${spec.company}`,
    company: spec.company,
    groupIc: spec.groupIc,
    pesStatus: spec.pes,
    informedCommander: true,
    exercises: spec.exercises.join('; '),
    sfabtType: spec.sfabt,
    windowConfirmed: true,
    location: spec.location,
    sftDate: sgtDay(spec.created),
  };
}

/**
 * Builds a genuinely encrypted and signed SFT webhook request.
 *
 * @param spec The submission.
 * @param options See `WebhookOptions`.
 * @returns The request to hand to the route.
 */
export function sftWebhookRequest(spec: SftSpec, options: WebhookOptions = {}): Request {
  const responses = sftResponsesOf(spec, options.extra);
  return signedRequest({ ...spec, responses }, { postUri: SFT_POST_URI, publicKey: SFT_FORM_KEYS.publicKey }, options);
}
