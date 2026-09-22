/**
 * Rule-based parser for the standard 40 SAR first-parade-state template.
 * Returns an `Extraction` plus the lines it could not read; any problem means "ask the model".
 */
import { COMPANIES, REPORT_SICK_TYPES, cleanText } from '../domain.ts';
import type { ExtractedCommandMember, ExtractedPerson, ExtractedUnit, Extraction } from './extraction.ts';

/** What the parser made of a message, and why it is unsure of it (empty when it is sure). */
export interface DeterministicResult {
  extraction: Extraction;
  problems: string[];
}

type Duty = Pick<
  ExtractedPerson,
  | 'duty_type'
  | 'sub_reason'
  | 'report_sick_type'
  | 'num_days'
  | 'is_permanent'
  | 'start_date'
  | 'end_date'
  | 'start_time'
>;

/** Ranks in use, longest first so `CPT(DR)` wins over `CPT`. */
const RANK = String.raw`(?:REC|PTE|LCP|CPL|CFC|SCT|[1-3]SG|SSG|MSG|[1-3]WO|MWO|SWO|CWO|OCT|2LT|LTA|CPT|MAJ|LTC|SLTC|COL|ME[1-8])(?:\s*\(DR\))?`;
const RANK_AT_START = new RegExp(String.raw`^(${RANK}|<RANK>)(?=\s|$)`, 'i');

/** A duty is recognised by any of these words; text with none of them is a medical condition. */
const DUTY_WORD =
  /\b(MC|LD|LIGHT DUTY|UFD|MA|EXCUSED?|OFF|OIL|LEAVE|AL|HL|COMPASSIONATE|CCL|HOSPITALI[SZ]ATION|IMT|IPPT|NS ?FIT|TP TEST|EX|GUARD|SDO|DUTY|COURSE|ATTACH\w*|WARDED|REVOKE\w*|ENDORSE\w*|RETURN\w*|STAY[- ]?IN|RMJ|FLEGS|RIB|PERM\w*)\b/i;

/** Sections whose lines may state a condition with no duty ("Fever (160926-180926) OUT"). */
const MEDICAL_SECTIONS = new Set(['Att C', 'Report Sick']);
/** The template's catch-all ("anything else"), so any text there is a duty. */
const FREE_TEXT_SECTION = 'Others';

const SECTIONS: Record<string, string> = {
  ATTC: 'Att C',
  STATUS: 'Status',
  REPORTSICK: 'Report Sick',
  MA: 'MA',
  'OFF/LEAVE': 'Off/Leave',
  OTHERS: 'Others',
};

const DDMMYY = String.raw`\d{6}`;
/** A date with an optional time; "TBC"/"TBA" is an appointment whose time is not yet known. */
const STAMP = String.raw`${DDMMYY}(?:\s+(?:\d{4}|TB[CA]))?`;
const UNKNOWN_TIME = /^TB[CA]$/i;
const DATE_GROUP = new RegExp(
  String.raw`^(?:SINCE\s+(${DDMMYY})|UNTIL\s+(${DDMMYY})|(${STAMP})(?:\s*-\s*(${STAMP}))?)$`,
  'i',
);
/** A detail with dates at its end: "laceration on chin 170926-180926". */
const DETAIL_THEN_DATES = new RegExp(
  String.raw`^(.*\S)\s+((?:SINCE|UNTIL)\s+${DDMMYY}|${STAMP}(?:\s*-\s*${STAMP})?)$`,
  'i',
);

const OLD_LAYOUT = /^(S\/N|R\s*&\s*N|R\/N|REASON|DURATION|STATUS RECEIVED|ATTC? ?LIST|MEDICAL STATUS|MEDICAL APPT|AL\/OIL|REPORTING SICK)\s*:/im;
const SEPARATOR_OR_BLANK = /^[^A-Za-z0-9]*$/;
const PLACEHOLDER = /^<[^>]*>$/;

const ROLE_LINE = /^(CDO|CDS|COS|PDS)\s*([^:]*?)\s*:\s*(.*)$/i;
const TIER_LINE = /^(OFFICERS?|WOSPECS?|ENLISTEES?)\s*:\s*(.*)$/i;
const SECTION_LINE = /^(ATT\s*C|STATUS|REPORT\s*SICK|MA|OFF\s*\/\s*LEAVE|OTHERS)\s*:\s*(\d*)\s*$/i;
const ANY_SECTION_LINE = new RegExp(SECTION_LINE.source, 'im');
const BLOCK_LINE = /^([A-Z][A-Z0-9 +&/]*?)\s*:\s*(\d+\s*\/\s*\d+|<P>\s*\/\s*<S>)$/i;
/** A block with a bare count ("Plt 7: 39"); only trusted once the body has begun. */
const BARE_BLOCK_LINE = /^([A-Z][A-Z0-9 +&/]*?)\s*:\s*(\d{1,3})$/i;
/** The report-sick sub-form some filers nest under REPORT SICK: "S/N: 01", "R/N: PTE TAN", "REASON: Fever". */
const SUB_FORM_LINE = /^(S\/N|R\s*[/&]\s*N|REASON)\s*:\s*(.*)$/i;
/** A name with no dash before its status ends where these begin: "(", "2D ", "1.5D ", "PERM". */
const NAME_END = /\s+-\s*|\s*-\s+|\s*\(|\s+\d+(?:\.\d+)?\s*D\s|\s+(?=PERM(?:ANENT)?\b)/i;

/**
 * Parses a parade-state message without a model.
 *
 * @param rawText The message, as stored.
 * @param today The receipt date, `yyyy-MM-dd`, used to resolve two-digit years.
 * @returns The extraction and, when unsure, the reasons; `problems` empty means trust it.
 */
export function parseParadeState(rawText: string, today: string): DeterministicResult {
  const text = cleanText(rawText).replace(/[–—]/g, '-');
  const lines = text.split('\n').map((line) => line.trim());
  const start = lines.findIndex((line) => ROLE_LINE.test(line) || BLOCK_LINE.test(line));
  const head = (start < 0 ? lines.slice(0, 5) : lines.slice(0, start)).join('\n').toUpperCase();

  if (/\bLAST PARADE STATE\b|\bLPS\b/.test(head)) {
    return sure(rejection('This is a LAST PARADE STATE; only first parade states are ingested.', 'LPS'));
  }
  // The template's own sections may nest an S/N sub-form; only its absence marks the old layout.
  if ((OLD_LAYOUT.test(text) && !ANY_SECTION_LINE.test(text)) || /^\s*\[[^\]]+\]\s*[A-Z0-9]/m.test(text)) {
    return sure(rejection('Parade state is in an older free-form layout, not the standard template.'));
  }
  if (start < 0) {
    return /PARADE STATE|\bFPS\b/.test(head)
      ? { extraction: rejection('No strength blocks found.'), problems: ['Says parade state but has no strength blocks.'] }
      : sure(rejection('Not a parade state.'));
  }

  const header = readHeader(head, today);
  const body = new BodyParser(header.fields.date ?? today);
  for (const line of lines.slice(start)) body.line(line);
  const problems = [...header.problems, ...body.finish()];

  return {
    extraction: {
      rejected: false,
      rejection_reason: null,
      ...header.fields,
      units: body.units,
      command_team: body.roster,
      personnel: body.personnel,
    },
    problems,
  };
}

/**
 * Reads company, date, time and session from the lines above the first block.
 *
 * @param head The header lines, upper-cased.
 * @param today The receipt date, `yyyy-MM-dd`.
 * @returns The header fields, and a problem for each one missing or invalid.
 */
function readHeader(
  head: string,
  today: string,
): { fields: Pick<Extraction, 'company' | 'date' | 'session' | 'parade_time'>; problems: string[] } {
  const problems: string[] = [];
  const named = COMPANIES.filter((company) => new RegExp(`\\b${company.toUpperCase()}\\b`).test(head));
  const company = named.length === 1 ? named[0]! : named.length === 0 && /\bHQ\b/.test(head) ? 'Hercules' : null;
  const stamp = /DATE\s*:\s*(\d{6})(?:\s*,?\s*TIME\s*:\s*(\d{4}))?/.exec(head);
  const date = stamp ? toIsoDate(stamp[1]!, today) : null;
  const parade_time = stamp?.[2] ? toTime(stamp[2]) : null;

  if (!company) problems.push(`Company not identifiable from the header (named: ${named.join(', ') || 'none'}).`);
  if (!date) problems.push('No valid "DATE: DDMMYY" in the header.');
  if (stamp?.[2] && !parade_time) problems.push(`Invalid parade time ${stamp[2]}.`);
  if (!/\bFIRST PARADE STATE\b|\bFPS\b/.test(head)) problems.push('Header does not say FIRST PARADE STATE.');
  return { fields: { company, date, session: 'FPS', parade_time }, problems };
}

/**
 * Walks the body line by line, tracking the current strength block and section.
 */
class BodyParser {
  readonly units: ExtractedUnit[] = [];
  readonly roster: ExtractedCommandMember[] = [];
  readonly personnel: ExtractedPerson[] = [];
  private readonly problems: string[] = [];
  private unit: ExtractedUnit | null = null;
  private section: string | null = null;
  private pending: { index?: string; who?: string; reason?: string } | null = null;

  /**
   * @param paradeDate The parade date, `yyyy-MM-dd`, that entry years resolve against.
   */
  constructor(private readonly paradeDate: string) {}

  /**
   * Consumes one line.
   *
   * @param line One trimmed line.
   */
  line(line: string): void {
    if (SEPARATOR_OR_BLANK.test(line)) return;

    const subForm = SUB_FORM_LINE.exec(line);
    if (subForm && this.section) return this.subFormLine(subForm[1]!, subForm[2]!.trim());
    this.flushSubForm();

    const role = ROLE_LINE.exec(line);
    if (role) {
      this.roster.push(commandMember(role[1]!.toUpperCase(), role[2]!, role[3]!));
      return;
    }
    const tier = TIER_LINE.exec(line);
    if (tier && this.unit) return this.tier(tier[1]!, tier[2]!, line);
    const section = SECTION_LINE.exec(line);
    if (section) return this.openSection(section[1]!, section[2]!, line);
    const block = BLOCK_LINE.exec(line) ?? (this.unit ? BARE_BLOCK_LINE.exec(line) : null);
    if (block) return this.openBlock(block[1]!, block[2]!);

    if (!this.unit || !this.section) {
      this.problems.push(`Line outside any section: "${line}"`);
    } else if (!/^(NIL|NONE)$/i.test(line)) {
      this.entry(line);
    }
  }

  /**
   * Final whole-message checks.
   *
   * @returns Every problem found.
   */
  finish(): string[] {
    this.flushSubForm();
    if (this.units[0]?.unit_label !== 'Company') this.problems.push('The first strength block is not COMPANY.');
    return this.problems;
  }

  /**
   * Parses one personnel line under the current block and section.
   *
   * @param line The personnel line.
   */
  private entry(line: string): void {
    const parsed = parseEntry(line, this.paradeDate, {
      unit_label: this.unit!.unit_label,
      reason_category: this.section!,
    });
    this.personnel.push(...parsed.entries);
    this.problems.push(...parsed.problems);
  }

  /**
   * Collects one line of the "S/N: / R/N: / REASON:" sub-form.
   *
   * @param label S/N, R/N (or R & N) or REASON, as written.
   * @param value Everything after the colon.
   */
  private subFormLine(label: string, value: string): void {
    const key = label.toUpperCase();
    if (key === 'S/N') {
      this.flushSubForm();
      this.pending = { index: value };
    } else if (key === 'REASON') {
      this.pending = { ...this.pending, reason: value };
      this.flushSubForm();
    } else {
      this.pending = { ...this.pending, who: value };
    }
  }

  /**
   * Turns a collected sub-form into an ordinary personnel line. A serial number with no
   * rank and name ("S/N: 00") is an empty form and yields nothing.
   */
  private flushSubForm(): void {
    const form = this.pending;
    this.pending = null;
    if (!form?.who) return;
    const index = form.index && /^\d+$/.test(form.index) ? `${Number(form.index)}. ` : '';
    this.entry(`${index}${form.who}${form.reason ? ` - ${form.reason}` : ''}`);
  }

  /**
   * Starts a strength block ("PL 1: 37/39").
   *
   * @param label The block label as written.
   * @param figures Its present/strength.
   */
  private openBlock(label: string, figures: string): void {
    const clean = label.toUpperCase().replace(/\s+/g, ' ');
    const total = fraction(figures)!;
    this.unit = {
      unit_label: clean === 'COMPANY' ? 'Company' : clean,
      total_present: total.present,
      total_strength: total.strength,
      officer_present: null,
      officer_strength: null,
      wospec_present: null,
      wospec_strength: null,
      enlistee_present: null,
      enlistee_strength: null,
      section_counts: [],
    };
    this.units.push(this.unit);
    this.section = null;
  }

  /**
   * Records a rank tier ("OFFICER: 2/4") on the current block.
   *
   * @param name The tier as written.
   * @param figures Its present/strength.
   * @param line The whole line, for the problem message.
   */
  private tier(name: string, figures: string, line: string): void {
    const kind = /^OFF/i.test(name) ? 'officer' : /^WO/i.test(name) ? 'wospec' : 'enlistee';
    const value = fraction(figures);
    if (!value) {
      this.problems.push(`Unreadable strength figure: "${line}"`);
      return;
    }
    this.unit![`${kind}_present`] = value.present;
    this.unit![`${kind}_strength`] = value.strength;
  }

  /**
   * Opens one of the six sections and records the count its header claims.
   *
   * @param name The section as written.
   * @param count The stated count, or '' when none.
   * @param line The whole line, for the problem message.
   */
  private openSection(name: string, count: string, line: string): void {
    if (!this.unit) {
      this.problems.push(`Section header outside any strength block: "${line}"`);
      return;
    }
    this.section = SECTIONS[name.toUpperCase().replace(/\s+/g, '')]!;
    this.unit.section_counts.push({
      reason_category: this.section,
      stated_count: count ? Number(count) : null,
    });
  }
}

/**
 * Parses one personnel line. Two authorisations with their own dates, joined by a comma,
 * become two entries; several activities sharing one date range stay one entry (template R1).
 *
 * @param line The line as written.
 * @param paradeDate The parade date, `yyyy-MM-dd`, used to resolve years.
 * @param where The block and section the line sits under.
 * @returns The entries, and the problems that make the line untrustworthy.
 */
export function parseEntry(
  line: string,
  paradeDate: string,
  where: { unit_label: string; reason_category: string },
): { entries: ExtractedPerson[]; problems: string[] } {
  const problems: string[] = [];
  const flag = (why: string) => problems.push(`${why}: "${line}"`);
  let rest = line;

  const index = /^(?:(\d+)\s*[.)]|-)\s*/.exec(rest);
  const entry_index = index?.[1] ? Number(index[1]) : null;
  if (index) rest = rest.slice(index[0].length);

  let location: string | null = null;
  const at = rest.indexOf('@');
  if (at >= 0) {
    location = rest.slice(at + 1).trim() || null;
    rest = rest.slice(0, at).trim();
  }

  // "OUT"/"IN" can sit at the very end or before a trailing "- reason". "STAY IN" is a duty.
  let in_camp: boolean | null = null;
  const camp = /(?<!STAY[- ]?)\s+(OUT|IN)(?=\s*(?:-\s+[^()]*)?$)/i.exec(rest);
  if (camp) {
    in_camp = camp[1]!.toUpperCase() === 'IN';
    rest = (rest.slice(0, camp.index) + rest.slice(camp.index + camp[0].length)).trim();
  }

  let four_d: string | null = null;
  const id = /^([A-Z]?\d{3,5}[A-Z]?|<4D>)\s+/i.exec(rest);
  if (id) {
    four_d = PLACEHOLDER.test(id[1]!) ? null : id[1]!.toUpperCase();
    rest = rest.slice(id[0].length);
  }

  let rank: string | null = null;
  const rankMatch = RANK_AT_START.exec(rest);
  if (rankMatch) {
    rank = PLACEHOLDER.test(rankMatch[1]!) ? null : rankMatch[1]!.toUpperCase().replace(/\s+/g, '');
    rest = rest.slice(rankMatch[0].length).trim();
  }

  // The name runs up to a spaced dash, a bracket, a day count ("2D ...") or "PERM".
  const end = NAME_END.exec(rest);
  const name = (end ? rest.slice(0, end.index) : rest).trim().replace(/-$/, '').trim();
  const status = end ? rest.slice(end.index).trim().replace(/^-\s*/, '') : '';

  if (!name || /[\d<>()@]/.test(name)) flag('Name not separable');

  const base = { unit_label: where.unit_label, reason_category: where.reason_category, entry_index, four_d, rank, name, in_camp, location, source_line: line };
  const parts = authorisations(status);
  const entries = parts.map((part) => ({ ...base, ...parseDuty(part, paradeDate, where.reason_category, flag) }));
  return { entries, problems };
}

/**
 * Splits a status into authorisations: on a top-level comma only when every piece carries
 * its own bracketed dates, as in "5D MC (130926-170926), 2D MC (170926-180926)".
 *
 * @param status Everything after the name.
 * @returns One string per authorisation.
 */
function authorisations(status: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of status) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      pieces.push(current.trim());
      current = '';
    } else current += ch;
  }
  pieces.push(current.trim());
  const dated = (piece: string) => /\(\s*(?:SINCE|UNTIL)?\s*\d{6}/i.test(piece);
  return pieces.length > 1 && pieces.every(dated) ? pieces : [status];
}

/**
 * Parses one authorisation: "[PERM] [nD] DUTY (detail) (dates) [- reason]".
 *
 * @param text The authorisation text.
 * @param paradeDate The parade date, `yyyy-MM-dd`.
 * @param section The reason category it sits under.
 * @param flag Records a problem against the line.
 * @returns The duty fields.
 */
function parseDuty(text: string, paradeDate: string, section: string, flag: (why: string) => void): Duty {
  const duty: Duty = {
    duty_type: null,
    sub_reason: null,
    report_sick_type: null,
    num_days: null,
    is_permanent: false,
    start_date: null,
    end_date: null,
    start_time: null,
  };
  const details: string[] = [];

  let bare = text.replace(/\(([^()]*)\)/g, (_, inner: string) => {
    readBracket(inner.trim(), paradeDate, duty, details, flag);
    return ' ';
  });
  if (/[()]/.test(bare)) flag('Unbalanced brackets');

  const reason = /\s+-\s+(.+)$|^-\s+(.+)$/.exec(bare);
  if (reason) {
    details.push((reason[1] ?? reason[2])!.trim());
    bare = bare.slice(0, reason.index);
  }
  bare = bare.replace(/\s+/g, ' ').trim();

  const days =
    /^(\d+(?:\.\d+)?)\s*D(?:AYS?)?\s+/i.exec(bare) ?? /^(PERM(?:ANENT)?)\s+(\d+(?:\.\d+)?)\s*D\s+/i.exec(bare);
  if (days) {
    // "1.5D AL" spans two calendar days, and the column holds whole days.
    duty.num_days = Math.ceil(Number(days[days.length - 1]));
    bare = bare.slice(0, days.index) + bare.slice(days.index + days[0].length);
  }
  if (/\bPERM(ANENT)?\b/i.test(bare)) {
    duty.is_permanent = true;
    bare = bare.replace(/\bPERM(ANENT)?\b\s*/gi, '').trim();
  }
  if (!duty.start_date && !duty.end_date) bare = takeBareDates(bare, paradeDate, duty, section);
  if (duty.is_permanent) duty.num_days = null;

  const rsType = REPORT_SICK_TYPES.find((type) => bare.toUpperCase() === type);
  if (rsType) {
    duty.report_sick_type = rsType;
    bare = '';
  } else if (PLACEHOLDER.test(bare)) {
    bare = ''; // an unfilled "<RSI/RSO>": the type is simply unknown
  }

  if (/\d{6}/.test(bare) && section !== FREE_TEXT_SECTION) flag('Date outside brackets');
  if (bare && !DUTY_WORD.test(bare) && section !== FREE_TEXT_SECTION) {
    if (MEDICAL_SECTIONS.has(section)) {
      details.unshift(bare); // a condition with no duty, which the template allows here
      bare = '';
    } else flag(`Unrecognised duty "${bare}"`);
  }

  duty.duty_type = bare || null;
  duty.sub_reason = details.length ? details.join(' - ') : null;
  if (!duty.duty_type && !duty.sub_reason && !duty.report_sick_type && !duty.start_date && !duty.end_date) {
    flag('No duty, reason or dates');
  }
  return duty;
}

/**
 * Reads dates written without brackets. A trailing date form ("OFF IN LIEU 210926") is taken
 * off the duty; under OTHERS, a lone date inside the free text ("coming back 150926 morning")
 * is read but the text is kept as written.
 *
 * @param bare The duty text, brackets already removed.
 * @param paradeDate The parade date, `yyyy-MM-dd`.
 * @param duty The duty being filled in.
 * @param section The reason category it sits under.
 * @returns The duty text left once the dates are taken.
 */
function takeBareDates(bare: string, paradeDate: string, duty: Duty, section: string): string {
  const split = DETAIL_THEN_DATES.exec(bare);
  const trailing = split ? readDates(split[2]!, paradeDate) : null;
  if (split && trailing) {
    Object.assign(duty, trailing);
    return split[1]!;
  }
  const embedded = bare.match(new RegExp(String.raw`\b${DDMMYY}\b`, 'g'));
  const date = section === FREE_TEXT_SECTION && embedded?.length === 1 ? toIsoDate(embedded[0]!, paradeDate) : null;
  if (date) Object.assign(duty, { start_date: date, end_date: date });
  return bare;
}

/**
 * Reads one bracket's content into the duty: dates, a report-sick token, or a detail.
 *
 * @param inner The text inside the brackets.
 * @param paradeDate The parade date, `yyyy-MM-dd`.
 * @param duty The duty being filled in.
 * @param details Collected free-text details.
 * @param flag Records a problem against the line.
 */
function readBracket(
  inner: string,
  paradeDate: string,
  duty: Duty,
  details: string[],
  flag: (why: string) => void,
): void {
  const token = inner.toUpperCase();
  if (REPORT_SICK_TYPES.includes(token as never)) {
    duty.report_sick_type = token;
    return;
  }
  if (PLACEHOLDER.test(inner)) return; // an unfilled "(<RSI/RSO>)"

  const dates = readDates(inner, paradeDate);
  if (dates) {
    Object.assign(duty, dates);
    return;
  }
  const split = DETAIL_THEN_DATES.exec(inner);
  const trailing = split ? readDates(split[2]!, paradeDate) : null;
  if (split && trailing) {
    Object.assign(duty, trailing);
    details.push(split[1]!);
    return;
  }
  if (/\d{6}|\d{1,2}\/\d{1,2}/.test(inner)) flag(`Unreadable dates "(${inner})"`);
  else details.push(inner);
}

/**
 * Reads a bracketed date form from the template.
 *
 * @param text The bracket content.
 * @param paradeDate The parade date, `yyyy-MM-dd`.
 * @returns The date fields, or null when the text is not one of the date forms.
 */
function readDates(text: string, paradeDate: string): Partial<Duty> | null {
  const match = DATE_GROUP.exec(text.trim());
  if (!match) return null;
  const [, since, until, from, to] = match;
  if (since) {
    const result = { start_date: toIsoDate(since, paradeDate), is_permanent: true };
    return validDates(result) ? result : null;
  }
  if (until) {
    const result = { end_date: toIsoDate(until, paradeDate) };
    return validDates(result) ? result : null;
  }

  const [startDay, startTime] = splitStamp(from!);
  const [endDay, endTime] = splitStamp(to ?? from!);
  const result: Partial<Duty> = {
    start_date: toIsoDate(startDay!, paradeDate),
    end_date: toIsoDate(endDay!, paradeDate),
    start_time: startTime ? toTime(startTime) : null,
  };
  if (to && startTime && endTime) result.num_days = 1; // an overnight duty is one duty
  return validDates(result) && (!startTime || result.start_time) ? result : null;
}

/**
 * Splits "DDMMYY [HHMM|TBC]" into its day and time.
 *
 * @param stamp One date stamp.
 * @returns The day, and the time or undefined when none (or "TBC"/"TBA") is given.
 */
function splitStamp(stamp: string): [string, string | undefined] {
  const [day, time] = stamp.split(/\s+/);
  return [day!, time && !UNKNOWN_TIME.test(time) ? time : undefined];
}

/**
 * Checks that every date a result sets actually parsed.
 *
 * @param result Parsed date fields.
 * @returns False when a stated date was impossible (e.g. month 13).
 */
function validDates(result: Partial<Duty>): boolean {
  return (['start_date', 'end_date'] as const).every((key) => !(key in result) || result[key] !== null);
}

/**
 * Converts DDMMYY to `yyyy-MM-dd`, taking the century-and-decade nearest the reference date,
 * so a mistyped year digit ("190936" for "190926") lands in the right year.
 *
 * @param ddmmyy Six digits.
 * @param reference A `yyyy-MM-dd` date the value should be near.
 * @returns The ISO date, or null when the day or month is impossible.
 */
export function toIsoDate(ddmmyy: string, reference: string): string | null {
  const day = Number(ddmmyy.slice(0, 2));
  const month = Number(ddmmyy.slice(2, 4));
  const stated = 2000 + Number(ddmmyy.slice(4, 6));
  const refYear = Number(reference.slice(0, 4)) || stated;
  // More than a year out is a typo; keep the stated month and day in the nearest year.
  const year = Math.abs(stated - refYear) > 1 ? refYear : stated;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Converts HHMM to `HH:MM`.
 *
 * @param hhmm Four digits.
 * @returns The time, or null when it is not a real time of day.
 */
function toTime(hhmm: string): string | null {
  const hours = Number(hhmm.slice(0, 2));
  const minutes = Number(hhmm.slice(2, 4));
  return hours < 24 && minutes < 60 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}` : null;
}

/**
 * Reads "62/66", a bare "0", or the "<P>/<S>" placeholder.
 *
 * @param text The figure as written.
 * @returns Present and strength (null when not stated), or null when unreadable.
 */
function fraction(text: string): { present: number | null; strength: number | null } | null {
  const value = text.trim();
  if (/^<P>\s*\/\s*<S>$/i.test(value) || value === '') return { present: null, strength: null };
  const pair = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (pair) return { present: Number(pair[1]), strength: Number(pair[2]) };
  if (/^\d+$/.test(value)) return { present: Number(value), strength: null };
  return null;
}

/**
 * Builds a command-team member from "CDO: 2LT TAN", "PDS SIG: -" or "PDS 1: <RANK> <NAME>".
 *
 * @param role CDO, CDS, COS or PDS.
 * @param label The sub-unit after PDS, if any.
 * @param holder Everything after the colon.
 * @returns The member; unfilled or dashed appointments are vacant.
 */
function commandMember(role: string, label: string, holder: string): ExtractedCommandMember {
  const unit_label = role === 'PDS' ? label.trim().toUpperCase() || null : null;
  const who = holder.trim();
  if (/^(-+|NIL|N\/A|)$/i.test(who) || /^<RANK>\s*<NAME>$/i.test(who)) {
    return { role_kind: role, unit_label, rank: null, name: null, is_vacant: true };
  }
  const rank = RANK_AT_START.exec(who);
  return {
    role_kind: role,
    unit_label,
    rank: rank ? rank[1]!.toUpperCase().replace(/\s+/g, '') : null,
    name: (rank ? who.slice(rank[0].length) : who).trim(),
    is_vacant: false,
  };
}

/**
 * Builds a rejected extraction.
 *
 * @param reason Why, in one sentence.
 * @param session The session, when the rejection is because of it.
 * @returns The extraction.
 */
function rejection(reason: string, session: string | null = null): Extraction {
  return {
    rejected: true,
    rejection_reason: reason,
    company: null,
    date: null,
    session,
    parade_time: null,
    units: [],
    command_team: [],
    personnel: [],
  };
}

/**
 * Wraps an extraction the parser is sure of.
 *
 * @param extraction The extraction.
 * @returns It, with no problems.
 */
function sure(extraction: Extraction): DeterministicResult {
  return { extraction, problems: [] };
}
