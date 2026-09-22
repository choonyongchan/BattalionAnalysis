/**
 * The rule-based parser, checked against dummy parade states: whatever a message says in the
 * standard template must come back exactly as stated, and a message the rules cannot read with
 * certainty must say so rather than guess. Expectations are read off the spec, not the parser.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { describe, expect, test } from 'bun:test';
import { parseParadeState } from '../../lib/parser/deterministic.ts';
import { validate } from '../../lib/parser/rows.ts';
import {
  companyTotals,
  expectedCounts,
  expectedPeople,
  renderParadeState,
  unitTotal,
  type ParadeSpec,
} from '../support/paradeState.ts';
import { DOUBTFUL_EDITS, LAST_PARADE, SCENARIOS, randomSpec } from '../support/scenarios.ts';

/** Named scenarios plus generated ones, so the rules meet shapes nobody wrote by hand. */
const CASES: Array<[string, ParadeSpec]> = [
  ...SCENARIOS.map(({ name, spec }): [string, ParadeSpec] => [name, spec]),
  ...Array.from({ length: 40 }, (_, seed): [string, ParadeSpec] => [`generated #${seed}`, randomSpec(seed)]),
];

/**
 * Reads a rendered spec the way the pipeline does, with the parade date as "today".
 *
 * @param spec The parade state.
 * @returns The parser's result.
 */
function read(spec: ParadeSpec) {
  return parseParadeState(renderParadeState(spec), spec.date);
}

describe('a template message reads back exactly as written', () => {
  test.each(CASES)('%s', (_name, spec) => {
    const { extraction, problems } = read(spec);

    expect(problems).toEqual([]);
    expect(validate(extraction)).toBe('');
    expect(extraction).toMatchObject({
      rejected: false,
      company: spec.company,
      date: spec.date,
      session: 'FPS',
      parade_time: `${spec.time.slice(0, 2)}:${spec.time.slice(2)}`,
    });

    const totals = companyTotals(spec);
    const company = extraction.units.find((unit) => unit.unit_label === 'Company');
    expect(company).toMatchObject({ total_present: totals.total.present, total_strength: totals.total.strength });

    for (const unit of spec.units) {
      const read = extraction.units.find((candidate) => candidate.unit_label === unit.label);
      expect(read).toMatchObject({
        total_present: unitTotal(unit).present,
        total_strength: unitTotal(unit).strength,
        officer_present: unit.officer.present,
        wospec_strength: unit.wospec.strength,
        enlistee_present: unit.enlistee.present,
      });
      // Each section's stated count is the number of lines filed under it.
      for (const section of read!.section_counts) {
        const lines = unit.entries.filter((entry) => entry.section === section.reason_category).length;
        expect(section.stated_count).toBe(lines);
      }
    }

    expect(extraction.personnel).toHaveLength(expectedCounts(spec).personnel);
    expect(extraction.command_team).toHaveLength(expectedCounts(spec).roster);
    expectedPeople(spec).forEach((person, index) => {
      expect(extraction.personnel[index]).toMatchObject(person);
    });
  });
});

describe('a message the rules cannot be sure of is flagged, not guessed', () => {
  const base = renderParadeState(SCENARIOS[1]!.spec);

  test.each(DOUBTFUL_EDITS.map(({ name, edit }) => [name, edit] as const))('%s', (_name, edit) => {
    const edited = edit(base);
    expect(edited).not.toBe(base);
    expect(parseParadeState(edited, SCENARIOS[1]!.spec.date).problems.length).toBeGreaterThan(0);
  });
});

describe('a last parade state', () => {
  test('is rejected with a reason, whatever else it contains', () => {
    const { extraction } = read(LAST_PARADE);
    expect(extraction.rejected).toBe(true);
    expect(validate(extraction)).not.toBe('');
  });
});
