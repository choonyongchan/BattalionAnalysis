/**
 * The OpenAI fallback against the real API: proves the configured model exists, accepts the
 * strict schema, and reads a parade state correctly. The fake-`fetch` suite cannot catch a bad
 * model id or a schema the API rejects; this one can.
 *
 * Skipped unless `OPENAI_API_KEY` is set (in `.env.test`, which `bun test` loads), so `bun test`
 * stays offline by default. Each run makes a few billed calls.
 * NAMES ARE SYNTHETIC: no real soldier's name or 4D number may appear here.
 */
import { describe, expect, test } from 'bun:test';
import { OpenAiParser } from '../../lib/parser/llm.ts';
import { validate } from '../../lib/parser/rows.ts';
import { companyTotals, expectedCounts, expectedPeople, renderParadeState } from '../support/paradeState.ts';
import { LAST_PARADE, SCENARIOS } from '../support/scenarios.ts';

/** The live parser, or null when no key is configured. */
const parser = OpenAiParser.fromEnv();

/** Generous per-test timeout: `parse` may make two calls of up to 120 s each. */
const LIVE_TIMEOUT_MS = 250_000;

describe.skipIf(!parser)(`OpenAiParser against the live API (${parser?.model ?? 'no key'})`, () => {
  test(
    'reads a parade state with one entry in every section',
    async () => {
      const spec = SCENARIOS[1]!.spec;
      const extraction = await parser!.parse(renderParadeState(spec), spec.date);

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

      expect(extraction.command_team).toHaveLength(expectedCounts(spec).roster);
      expect(extraction.personnel).toHaveLength(expectedCounts(spec).personnel);
      expectedPeople(spec).forEach((person, index) => {
        expect(extraction.personnel[index]).toMatchObject({
          unit_label: person.unit_label,
          reason_category: person.reason_category,
          four_d: person.four_d,
          name: person.name,
        });
      });
    },
    LIVE_TIMEOUT_MS,
  );

  test(
    'rejects a last parade state with a reason',
    async () => {
      const extraction = await parser!.parse(renderParadeState(LAST_PARADE), LAST_PARADE.date);

      expect(extraction.rejected).toBe(true);
      expect(extraction.rejection_reason).toBeTruthy();
    },
    LIVE_TIMEOUT_MS,
  );
});
