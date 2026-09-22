/**
 * Dummy parade states for data-driven tests.
 *
 * A test describes a parade state as data (`ParadeSpec`), renders it into the standard template
 * (`parade-state-example/parade_state_template.txt`) with `renderParadeState`, and checks the
 * system against what the spec says -- never against the parser's internals. The expectations
 * here are read off the spec alone, the way a clerk reading the message would count it.
 *
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */

/** The six section names of the template, as the parser and database spell them. */
export const SECTIONS = ['Att C', 'Status', 'Report Sick', 'MA', 'Off/Leave', 'Others'] as const;

/** One of the six sections. */
export type Section = (typeof SECTIONS)[number];

/** How each section's header is written in a message. */
const SECTION_HEADERS: Record<Section, string> = {
  'Att C': 'ATT C',
  Status: 'STATUS',
  'Report Sick': 'REPORT SICK',
  MA: 'MA',
  'Off/Leave': 'OFF/LEAVE',
  Others: 'OTHERS',
};

/** A present/strength pair. */
export interface Tier {
  present: number;
  strength: number;
}

/** One entry line under a section. */
export interface EntrySpec {
  section: Section;
  /** Omitted for commanders who have no 4D. */
  fourD?: string;
  rank: string;
  name: string;
  /** The duty word(s), e.g. `MC`, `EXCUSE RMJ`, `LEAVE`; for Report Sick, the type (`RSI`...). */
  duty: string;
  /** The stated duration in days, written `<n>D` before the duty. */
  days?: number;
  /** Written `PERM` before the duty, with no dates. */
  perm?: boolean;
  /** ISO start date. */
  from?: string;
  /** ISO end date; omitted for a single day. */
  to?: string;
  /** Appointment time, `HH:MM`, on a single day. */
  at?: string;
  inCamp?: 'IN' | 'OUT';
  reason?: string;
  location?: string;
}

/** What one entry should become once read, as a person reading the line would record it. */
export interface ExpectedPerson {
  unit_label: string;
  reason_category: Section;
  four_d: string | null;
  rank: string;
  name: string;
  duty_type: string | null;
  report_sick_type: string | null;
  num_days: number | null;
  is_permanent: boolean;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  in_camp: boolean | null;
  location: string | null;
  sub_reason: string | null;
}

/** A strength block (HQ or a platoon) and the entries filed under it. */
export interface UnitSpec {
  label: string;
  officer: Tier;
  wospec: Tier;
  enlistee: Tier;
  entries: EntrySpec[];
}

/** A command appointment line. */
export interface CommandSpec {
  role: 'CDO' | 'CDS' | 'COS' | 'PDS 1' | 'PDS 2' | 'PDS 3' | 'PDS 4';
  rank: string;
  name: string;
}

/** A whole parade state. */
export interface ParadeSpec {
  company: string;
  /** ISO `yyyy-MM-dd`. */
  date: string;
  session: 'FPS' | 'LPS';
  /** `HHMM`. */
  time: string;
  command: CommandSpec[];
  units: UnitSpec[];
}

/**
 * Formats an ISO date as the template's `DDMMYY`.
 *
 * @param iso A `yyyy-MM-dd` date.
 * @returns The same day as `DDMMYY`.
 */
export function ddmmyy(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}${month}${year!.slice(2)}`;
}

/**
 * Adds days to an ISO date.
 *
 * @param iso A `yyyy-MM-dd` date.
 * @param days Days to add; may be negative.
 * @returns The new date.
 */
export function shiftIso(iso: string, days: number): string {
  const time = new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Sums the three rank tiers of a unit.
 *
 * @param unit The unit.
 * @returns Its total present and strength.
 */
export function unitTotal(unit: Pick<UnitSpec, 'officer' | 'wospec' | 'enlistee'>): Tier {
  const tiers = [unit.officer, unit.wospec, unit.enlistee];
  return {
    present: tiers.reduce((sum, tier) => sum + tier.present, 0),
    strength: tiers.reduce((sum, tier) => sum + tier.strength, 0),
  };
}

/**
 * The company-wide totals: every unit's tiers added together.
 *
 * @param spec The parade state.
 * @returns The company's officer, wospec, enlistee and total figures.
 */
export function companyTotals(spec: ParadeSpec): { officer: Tier; wospec: Tier; enlistee: Tier; total: Tier } {
  const add = (pick: (unit: UnitSpec) => Tier): Tier => ({
    present: spec.units.reduce((sum, unit) => sum + pick(unit).present, 0),
    strength: spec.units.reduce((sum, unit) => sum + pick(unit).strength, 0),
  });
  const officer = add((unit) => unit.officer);
  const wospec = add((unit) => unit.wospec);
  const enlistee = add((unit) => unit.enlistee);
  return { officer, wospec, enlistee, total: unitTotal({ officer, wospec, enlistee }) };
}

/**
 * Renders one entry line.
 *
 * @param entry The entry.
 * @param index Its 1-based number under its section.
 * @returns The line.
 */
export function renderEntry(entry: EntrySpec, index: number): string {
  const status = `${entry.perm ? 'PERM ' : ''}${entry.days ? `${entry.days}D ` : ''}${entry.duty}`;
  let line = `${index}. ${entry.fourD ? entry.fourD + ' ' : ''}${entry.rank} ${entry.name} - ${status}`;
  if (entry.from) {
    let dates = ddmmyy(entry.from);
    if (entry.to && entry.to !== entry.from) dates += `-${ddmmyy(entry.to)}`;
    else if (entry.at) dates += ` ${entry.at.replace(':', '')}`;
    line += ` (${dates})`;
  }
  if (entry.inCamp) line += ` ${entry.inCamp}`;
  if (entry.reason) line += ` - ${entry.reason}`;
  if (entry.location) line += ` @ ${entry.location}`;
  return line;
}

/**
 * Renders a present/strength block: the unit's own line and its three tiers.
 *
 * @param label The block's label, e.g. `COMPANY`, `HQ`, `PL 1`.
 * @param tiers The tier figures.
 * @returns The block's lines.
 */
function renderStrength(label: string, tiers: { officer: Tier; wospec: Tier; enlistee: Tier }): string[] {
  const total = unitTotal(tiers);
  const pair = (tier: Tier) => `${tier.present}/${tier.strength}`;
  return [
    `${label}: ${pair(total)}`,
    `OFFICER: ${pair(tiers.officer)}`,
    `WOSPEC: ${pair(tiers.wospec)}`,
    `ENLISTEE: ${pair(tiers.enlistee)}`,
  ];
}

/**
 * Renders a parade state in the standard template.
 *
 * @param spec The parade state.
 * @returns The message text, as a clerk would paste it.
 */
export function renderParadeState(spec: ParadeSpec): string {
  const lines: string[] = [
    `40 SAR ${spec.company.toUpperCase()} COMPANY`,
    spec.session === 'FPS' ? 'FIRST PARADE STATE' : 'LAST PARADE STATE',
    `DATE: ${ddmmyy(spec.date)} TIME: ${spec.time}`,
    '',
    ...spec.command.map((member) => `${member.role}: ${member.rank} ${member.name}`),
    '',
    '================================',
    ...renderStrength('COMPANY', companyTotals(spec)),
    '================================',
  ];
  spec.units.forEach((unit, position) => {
    if (position > 0) lines.push('', '--------------------------------');
    lines.push('', ...renderStrength(unit.label, unit), '');
    for (const section of SECTIONS) {
      const entries = unit.entries.filter((entry) => entry.section === section);
      lines.push(`${SECTION_HEADERS[section]}: ${entries.length}`);
      entries.forEach((entry, index) => lines.push(renderEntry(entry, index + 1)));
    }
  });
  return lines.join('\n');
}

/**
 * The natural key a parade state is stored under.
 *
 * @param spec The parade state.
 * @returns `<Company>_<yyyy-MM-dd>_<session>`.
 */
export function expectedKey(spec: Pick<ParadeSpec, 'company' | 'date' | 'session'>): string {
  return `${spec.company}_${spec.date}_${spec.session}`;
}

/**
 * How many rows of each kind a parade state should become, counted off the message.
 *
 * @param spec The parade state.
 * @returns One strength row per block (company included), one personnel row per entry line,
 *   one roster row per appointment, and one section count per section header.
 */
export function expectedCounts(spec: ParadeSpec): {
  strength: number;
  personnel: number;
  roster: number;
  sectionCounts: number;
} {
  return {
    strength: 1 + spec.units.length,
    personnel: spec.units.reduce((sum, unit) => sum + unit.entries.length, 0),
    roster: spec.command.length,
    sectionCounts: spec.units.length * SECTIONS.length,
  };
}

/**
 * Every entry of a parade state with the unit it was filed under.
 *
 * @param spec The parade state.
 * @returns The entries, in message order: by unit, then by section as `renderParadeState` writes them.
 */
export function allEntries(spec: ParadeSpec): Array<EntrySpec & { unit: string }> {
  return spec.units.flatMap((unit) =>
    SECTIONS.flatMap((section) =>
      unit.entries.filter((entry) => entry.section === section).map((entry) => ({ ...entry, unit: unit.label })),
    ),
  );
}

/**
 * What each entry of a parade state should be read as.
 *
 * @param spec The parade state.
 * @returns One expected person per entry line, in message order.
 */
export function expectedPeople(spec: ParadeSpec): ExpectedPerson[] {
  return allEntries(spec).map((entry) => {
    const reportSick = entry.section === 'Report Sick';
    return {
      unit_label: entry.unit,
      reason_category: entry.section,
      four_d: entry.fourD ?? null,
      rank: entry.rank,
      name: entry.name,
      duty_type: reportSick ? null : entry.duty,
      report_sick_type: reportSick ? entry.duty : null,
      num_days: entry.days ?? null,
      is_permanent: Boolean(entry.perm),
      start_date: entry.from ?? null,
      end_date: entry.to ?? entry.from ?? null,
      start_time: entry.at ?? null,
      in_camp: entry.inCamp ? entry.inCamp === 'IN' : null,
      location: entry.location ?? null,
      sub_reason: entry.reason ?? null,
    };
  });
}
