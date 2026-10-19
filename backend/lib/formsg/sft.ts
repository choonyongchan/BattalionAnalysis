/**
 * Maps a decrypted SFT submission to one `sft_formsg` row by question title; the long acknowledgement
 * questions match on a prefix so small wording edits do not unmap them.
 */
import { companyFromUnitCoy } from '../../../shared/domain.ts';
import { normaliseName } from '../../../shared/identity.ts';
import { normaliseTitle, toSgtDate } from './fields.ts';
import { answerText, type DecryptedSubmission, type MappedSubmission } from './map.ts';

/** Columns filled straight from an answer; `discard` marks titles dropped on purpose. */
type SftColumn =
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

/** Columns stored as a ticked/unticked boolean rather than text. */
const ACKNOWLEDGEMENTS = new Set<SftColumn>(['informedCommander', 'windowConfirmed']);

/** Identifies which column an answer belongs to. */
export function resolveSftField(answer: { question?: string }): SftColumn | null {
  if (!answer.question) return null;
  const title = normaliseTitle(answer.question);
  return TITLE_MAP[title] ?? TITLE_PREFIXES.find(([prefix]) => title.startsWith(prefix))?.[1] ?? null;
}

/** Collects each answer under its column. */
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

/** Maps a decrypted SFT submission to an insert-shaped row. */
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
