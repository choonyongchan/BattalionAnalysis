/**
 * Named dummy parade states, and a seeded generator of many more, for data-driven tests.
 *
 * NAMES ARE SYNTHETIC: every name is a phonetic-alphabet word plus a common surname, and every
 * 4D is a made-up number.
 */
import type { CommandSpec, EntrySpec, ParadeSpec, Tier, UnitSpec } from './paradeState.ts';
import { shiftIso } from './paradeState.ts';

/** The companies the database accepts. */
export const COMPANY_NAMES = ['Archer', 'Braves', 'Cougar', 'Stallion', 'Hercules'] as const;

const GIVEN = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA'];
const SURNAMES = ['TAN', 'LIM', 'ONG', 'NG', 'KOH', 'LEE', 'CHUA', 'WEE', 'GOH', 'TEO'];

/**
 * A small seeded PRNG (mulberry32), so a failing generated case can be reproduced by its seed.
 *
 * @param seed Any 32-bit integer.
 * @returns A function returning floats in [0, 1).
 */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A present/strength pair.
 *
 * @param present Present.
 * @param strength Strength.
 * @returns The tier.
 */
export function tier(present: number, strength: number): Tier {
  return { present, strength };
}

/**
 * A unit with no entries.
 *
 * @param label The block label.
 * @param enlistee Enlistee present/strength; officers and wospecs are fixed small numbers.
 * @param entries Entry lines to file under it.
 * @returns The unit.
 */
export function unit(label: string, enlistee: Tier, entries: EntrySpec[] = []): UnitSpec {
  return { label, officer: tier(1, 1), wospec: tier(2, 2), enlistee, entries };
}

/** A full command team, one per role. */
export const FULL_COMMAND: CommandSpec[] = [
  { role: 'CDO', rank: 'CPT', name: 'ALPHA TAN' },
  { role: 'CDS', rank: '1WO', name: 'BRAVO LIM' },
  { role: 'COS', rank: '2LT', name: 'CHARLIE ONG' },
  { role: 'PDS 1', rank: '3SG', name: 'DELTA NG' },
  { role: 'PDS 2', rank: '3SG', name: 'ECHO KOH' },
];

/** The fixed parade date the named scenarios use. */
export const SCENARIO_DATE = '2026-09-18';

/** Hand-written parade states, each exercising one kind of content. */
export const SCENARIOS: Array<{ name: string; spec: ParadeSpec }> = [
  {
    name: 'an HQ-only company with nothing to report',
    spec: {
      company: 'Hercules',
      date: SCENARIO_DATE,
      session: 'FPS',
      time: '0730',
      command: FULL_COMMAND.slice(0, 3),
      units: [unit('HQ', tier(40, 40))],
    },
  },
  {
    name: 'one entry in every section',
    spec: {
      company: 'Braves',
      date: SCENARIO_DATE,
      session: 'FPS',
      time: '0725',
      command: FULL_COMMAND,
      units: [
        unit('HQ', tier(10, 12), [
          { section: 'Att C', fourD: '2101', rank: 'REC', name: 'FOXTROT GOH', duty: 'MC', days: 3, from: '2026-09-17', to: '2026-09-19', reason: 'Fever', location: 'Sengkang GH' },
          { section: 'Status', fourD: '2102', rank: 'PTE', name: 'GOLF TEO', duty: 'LD', days: 2, from: '2026-09-18', to: '2026-09-19' },
          { section: 'Report Sick', fourD: '2103', rank: 'REC', name: 'HOTEL WEE', duty: 'RSI', from: '2026-09-18', reason: 'Cough' },
        ]),
        unit('PL 1', tier(30, 33), [
          { section: 'MA', fourD: '1101', rank: 'REC', name: 'INDIA LEE', duty: 'MA', from: '2026-09-22', at: '10:30', location: 'CMPB' },
          { section: 'Off/Leave', rank: '2LT', name: 'JULIET CHUA', duty: 'LEAVE', from: '2026-09-18', to: '2026-09-20' },
          { section: 'Others', fourD: '1102', rank: 'REC', name: 'KILO TAN', duty: 'GUARD DUTY', from: '2026-09-18', inCamp: 'IN' },
        ]),
      ],
    },
  },
  {
    name: 'a permanent status and one soldier on two lines',
    spec: {
      company: 'Cougar',
      date: SCENARIO_DATE,
      session: 'FPS',
      time: '0715',
      command: FULL_COMMAND.slice(0, 1),
      units: [
        unit('HQ', tier(8, 8)),
        unit('PL 2', tier(25, 27), [
          { section: 'Status', fourD: '2201', rank: 'REC', name: 'LIMA ONG', duty: 'EXCUSE RMJ', perm: true },
          { section: 'Status', fourD: '2202', rank: 'REC', name: 'ALPHA KOH', duty: 'EXCUSE FLEGS', days: 84, from: '2026-08-31', to: '2026-11-22' },
          { section: 'Status', fourD: '2202', rank: 'REC', name: 'ALPHA KOH', duty: 'EXCUSE STAY IN', days: 84, from: '2026-08-31', to: '2026-11-22', inCamp: 'OUT' },
        ]),
      ],
    },
  },
  {
    name: 'four platoons with report-sick types',
    spec: {
      company: 'Stallion',
      date: SCENARIO_DATE,
      session: 'FPS',
      time: '0700',
      command: FULL_COMMAND.slice(0, 2),
      units: [
        unit('HQ', tier(6, 6)),
        unit('PL 1', tier(20, 21), [{ section: 'Report Sick', fourD: '1301', rank: 'REC', name: 'BRAVO TEO', duty: 'RSO', from: '2026-09-18' }]),
        unit('PL 2', tier(20, 22), [{ section: 'Report Sick', fourD: '2301', rank: 'REC', name: 'CHARLIE GOH', duty: 'MR', from: '2026-09-18' }]),
        unit('PL 3', tier(19, 20), [{ section: 'Report Sick', fourD: '3301', rank: 'REC', name: 'DELTA LIM', duty: 'PENDING', from: '2026-09-18' }]),
        unit('PL 4', tier(22, 22)),
      ],
    },
  },
];

/** A last parade state: rejected, never stored as rows. */
export const LAST_PARADE: ParadeSpec = { ...SCENARIOS[1]!.spec, session: 'LPS' };

/** Edits to a rendered message that leave it unreadable with certainty, so a person must look. */
export const DOUBTFUL_EDITS: Array<{ name: string; edit: (text: string) => string }> = [
  { name: 'an unknown duty word', edit: (text) => text.replace('- 2D LD', '- SOMETHING UNHEARD OF') },
  { name: 'no DATE line', edit: (text) => text.replace(/^DATE: .*$/m, '') },
  { name: 'no company name', edit: (text) => text.replace('40 SAR BRAVES COMPANY', '40 SAR COMPANY') },
  { name: 'a line outside any section', edit: (text) => text.replace('HQ: ', 'stray words here\nHQ: ') },
];

/**
 * Picks one element.
 *
 * @param random The PRNG.
 * @param items The choices.
 * @returns One of them.
 */
function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/**
 * A whole number in `[low, high]`.
 *
 * @param random The PRNG.
 * @param low Lowest value.
 * @param high Highest value.
 * @returns The number.
 */
function between(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

/**
 * One random entry for a section, dated around the parade date.
 *
 * @param random The PRNG.
 * @param date The parade date.
 * @param fourD The soldier's 4D.
 * @returns The entry.
 */
function randomEntry(random: () => number, date: string, fourD: string): EntrySpec {
  const person = { fourD, rank: pick(random, ['REC', 'PTE', 'LCP', 'CPL']), name: `${pick(random, GIVEN)} ${pick(random, SURNAMES)}` };
  const span = (days: number, startOffset: number) => ({ days, from: shiftIso(date, startOffset), to: shiftIso(date, startOffset + days - 1) });
  switch (between(random, 0, 5)) {
    case 0:
      return { section: 'Att C', ...person, duty: 'MC', ...span(between(random, 2, 14), -between(random, 0, 1)) };
    case 1:
      return random() < 0.3
        ? { section: 'Status', ...person, duty: pick(random, ['EXCUSE RMJ', 'EXCUSE PYROTECHNICS']), perm: true }
        : { section: 'Status', ...person, duty: pick(random, ['LD', 'EXCUSE HEAVY LOAD', 'EXCUSE STAY IN']), ...span(between(random, 2, 30), 0) };
    case 2:
      return { section: 'Report Sick', ...person, duty: pick(random, ['RSI', 'RSO', 'MR', 'FFI', 'PENDING']), from: date };
    case 3:
      return { section: 'MA', ...person, duty: 'MA', from: shiftIso(date, between(random, 0, 10)), at: pick(random, ['08:30', '10:00', '14:15']), location: pick(random, ['CMPB', 'Changi GH']) };
    case 4:
      return { section: 'Off/Leave', ...person, duty: pick(random, ['LEAVE', 'OFF']), ...span(between(random, 2, 5), 0), days: undefined };
    default:
      return { section: 'Others', ...person, duty: pick(random, ['GUARD DUTY', 'COURSE']), from: date, inCamp: pick(random, ['IN', 'OUT'] as const) };
  }
}

/**
 * A random but valid parade state, reproducible from its seed.
 *
 * @param seed The seed.
 * @param overrides Fields to fix, such as the company or date.
 * @returns The parade state.
 */
export function randomSpec(seed: number, overrides: Partial<ParadeSpec> = {}): ParadeSpec {
  const random = prng(seed);
  const date = overrides.date ?? shiftIso('2026-09-01', between(random, 0, 20));
  const platoons = between(random, 0, 4);
  const labels = ['HQ', ...Array.from({ length: platoons }, (_, index) => `PL ${index + 1}`)];
  let serial = 0;
  const units = labels.map((label, position) => {
    const strength = between(random, 5, 40);
    const absent = between(random, 0, Math.min(6, strength));
    const entries = Array.from({ length: absent }, () => randomEntry(random, date, `${position + 1}${String(++serial).padStart(3, '0')}`));
    return unit(label, tier(strength - absent, strength), entries);
  });
  return {
    company: pick(random, COMPANY_NAMES),
    date,
    session: 'FPS',
    time: `07${String(between(random, 0, 59)).padStart(2, '0')}`,
    command: FULL_COMMAND.slice(0, between(random, 1, FULL_COMMAND.length)),
    units,
    ...overrides,
  };
}
