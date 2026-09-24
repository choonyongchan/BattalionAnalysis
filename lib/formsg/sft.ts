/**
 * Turns a decrypted Self-Regulated Fitness Training submission into one `sft_formsg` row.
 *
 * Answers are matched by field `_id` (v3 payloads carry no question text), else by question
 * title. The two long acknowledgement questions match on a prefix, so a small wording edit to
 * their tail does not unmap them.
 */
import { companyFromUnitCoy, normaliseName } from '../domain.ts';
import { normaliseTitle, toSgtDate } from './fields.ts';
import { answerText, type DecryptedSubmission, type MappedSubmission } from './map.ts';

/** Columns filled straight from an answer; `discard` marks titles dropped on purpose. */
export type SftColumn =
  | 'rank'
  | 'name'
  | 'unitCoy'
  | 'groupIc'
  | 'pesStatus'
  | 'informedCommander'
  | 'exercises'
  | 'sfabtType'
  | 'windowConfirmed'
  | 'location'
  | 'discard';

/** Question titles as they appear in the live form. */
const TITLE_MAP: Record<string, SftColumn> = Object.fromEntries(
  (
    [
      ['Rank', 'rank'],
      ['[Myinfo] Name', 'name'],
      ['Company', 'unitCoy'],
      ['Rank & Name of Group IC', 'groupIc'],
      ['PES Status', 'pesStatus'],
      ['What exercise will you be doing?', 'exercises'],
      ['Type of Service-Fit Ability Based Training (SFABT)', 'sfabtType'],
      ['Training Location', 'location'],
      // Known but not stored, so they do not trip the unmapped-question warning.
      ['Download Status', 'discard'],
      ['SingPass Validated NRIC', 'discard'],
      ['Masked NRIC', 'discard'],
    ] as const
  ).map(([title, column]) => [normaliseTitle(title), column]),
);

/** Acknowledgement questions, matched by the start of their title. */
const TITLE_PREFIXES: Array<[string, SftColumn]> = [
  [normaliseTitle('I have informed my commander'), 'informedCommander'],
  [normaliseTitle('My training is between 0700h and 2200h'), 'windowConfirmed'],
];

/**
 * Field ids harvested from a real submission, as `'<24-char id>': 'location'`.
 *
 * Required for v3 (multi-respondent) payloads, which carry no question text.
 */
export const SFT_FIELD_IDS: Record<string, SftColumn> = {};

/** Columns stored as a ticked/unticked boolean rather than text. */
const ACKNOWLEDGEMENTS = new Set<SftColumn>(['informedCommander', 'windowConfirmed']);

/**
 * Identifies which column an answer belongs to.
 *
 * @param answer The `_id` and `question` from a webhook response entry.
 * @returns The column, or null when the answer is not recognised.
 */
export function resolveSftField(answer: { _id?: string; question?: string }): SftColumn | null {
  if (answer._id && SFT_FIELD_IDS[answer._id]) return SFT_FIELD_IDS[answer._id]!;
  if (!answer.question) return null;
  const title = normaliseTitle(answer.question);
  return TITLE_MAP[title] ?? TITLE_PREFIXES.find(([prefix]) => title.startsWith(prefix))?.[1] ?? null;
}

/**
 * Collects each answer under its column.
 *
 * @param decrypted The submission.
 * @returns The answer text by column, and question titles that matched no column.
 */
function collectAnswers(decrypted: DecryptedSubmission): { answers: Map<SftColumn, string>; unmapped: string[] } {
  const answers = new Map<SftColumn, string>();
  const unmapped: string[] = [];
  for (const answer of decrypted.responses ?? []) {
    const column = resolveSftField(answer);
    if (!column) {
      if (answer.question) unmapped.push(answer.question);
    } else if (column !== 'discard') {
      answers.set(column, answerText(answer));
    }
  }
  return { answers, unmapped };
}

/**
 * Maps a decrypted SFT submission to an insert-shaped row.
 *
 * @param decrypted The submission, already decrypted and signature-checked.
 * @returns The row, unmapped question titles, and unrecognised answers.
 */
export function mapSftSubmission(decrypted: DecryptedSubmission): MappedSubmission {
  const { answers, unmapped } = collectAnswers(decrypted);
  const unrecognised: string[] = [];

  const values: Record<string, unknown> = {};
  for (const [column, text] of answers) {
    values[column] = ACKNOWLEDGEMENTS.has(column) ? text !== '' : text || null;
  }

  const unitCoy = answers.get('unitCoy');
  const company = companyFromUnitCoy(unitCoy);
  if (unitCoy && !company) unrecognised.push(`company=${unitCoy}`);

  const row = {
    responseId: decrypted.submissionId,
    timestamp: decrypted.submittedAt,
    ...values,
    nameKey: normaliseName(answers.get('name')),
    company,
    sftDate: toSgtDate(decrypted.submittedAt),
  };
  return { row, unmapped, unrecognised };
}
