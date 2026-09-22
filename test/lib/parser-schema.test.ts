/**
 * The Structured Outputs schema.
 *
 * OpenAI strict mode rejects a schema that breaks any of three rules, and it does so at
 * request time -- in production, on a real parade state, after the message has already been
 * accepted. Walking the whole tree here moves that failure to the test suite.
 *
 * The enum checks matter for a different reason: they are what proves the parser and the
 * database still share one vocabulary. The old system kept three hand-written copies of
 * these lists and tested that they matched; this asserts there is only one.
 */
import { describe, expect, test } from 'bun:test';
import { buildResponseSchema } from '../../lib/parser/schema.ts';
import {
  COMPANIES,
  REASON_CATEGORIES,
  REPORT_SICK_TYPES,
  ROLE_KINDS,
  SESSIONS,
} from '../../lib/domain.ts';

type Node = Record<string, any>;

/**
 * Visits every object-typed node in a JSON Schema.
 *
 * @param node The node to start from.
 * @param path A human-readable path, used in failure messages.
 * @param visit Called for each object node.
 */
function walkObjects(node: Node, path: string, visit: (n: Node, p: string) => void): void {
  if (!node || typeof node !== 'object') return;

  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('object')) {
    visit(node, path);
    for (const [key, child] of Object.entries(node.properties ?? {})) {
      walkObjects(child as Node, `${path}.${key}`, visit);
    }
  }
  if (types.includes('array') && node.items) {
    walkObjects(node.items as Node, `${path}[]`, visit);
  }
}

const schema = buildResponseSchema();

describe('strict-mode invariants', () => {
  test('is declared strict and named', () => {
    expect(schema.strict).toBe(true);
    expect(schema.name).toBe('parade_state');
  });

  test('every object lists all of its properties in required', () => {
    walkObjects(schema.schema as Node, 'root', (node, path) => {
      const properties = Object.keys(node.properties ?? {});
      const required = (node.required ?? []) as string[];
      expect(
        { path, missing: properties.filter((p) => !required.includes(p)) },
      ).toEqual({ path, missing: [] });
    });
  });

  test('every object forbids additional properties', () => {
    walkObjects(schema.schema as Node, 'root', (node, path) => {
      expect({ path, additionalProperties: node.additionalProperties }).toEqual({
        path,
        additionalProperties: false,
      });
    });
  });

  test('required never names a property that does not exist', () => {
    walkObjects(schema.schema as Node, 'root', (node, path) => {
      const properties = Object.keys(node.properties ?? {});
      const stray = ((node.required ?? []) as string[]).filter((r) => !properties.includes(r));
      expect({ path, stray }).toEqual({ path, stray: [] });
    });
  });

  test('nullability is expressed as a union type, never a nullable flag', () => {
    const offenders: string[] = [];
    walkObjects(schema.schema as Node, 'root', (node, path) => {
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if ('nullable' in (child as Node)) offenders.push(`${path}.${key}`);
      }
    });
    expect(offenders).toEqual([]);
  });

  test('a nullable enum also admits null as a value', () => {
    // An enum listing only strings while the type allows null is rejected at request time.
    const offenders: string[] = [];
    walkObjects(schema.schema as Node, 'root', (node, path) => {
      for (const [key, raw] of Object.entries(node.properties ?? {})) {
        const child = raw as Node;
        if (!child.enum) continue;
        const types = Array.isArray(child.type) ? child.type : [child.type];
        if (types.includes('null') && !child.enum.includes(null)) {
          offenders.push(`${path}.${key}`);
        }
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe('the vocabulary is the database vocabulary', () => {
  const root = schema.schema as Node;
  const person = root.properties.personnel.items.properties;
  const member = root.properties.command_team.items.properties;
  const section = root.properties.units.items.properties.section_counts.items.properties;

  test('companies match the company enum', () => {
    expect(root.properties.company.enum).toEqual([...COMPANIES, null]);
  });

  test('sessions match the session enum, LPS included so a rejection can name it', () => {
    expect(root.properties.session.enum).toEqual([...SESSIONS, null]);
    expect(root.properties.session.enum).toContain('LPS');
  });

  test('section names match the reason_category enum in both places they appear', () => {
    expect(person.reason_category.enum).toEqual([...REASON_CATEGORIES]);
    expect(section.reason_category.enum).toEqual([...REASON_CATEGORIES]);
  });

  test('role kinds match the role_kind enum', () => {
    expect(member.role_kind.enum).toEqual([...ROLE_KINDS]);
  });

  test('report-sick types match the report_sick_type enum', () => {
    expect(person.report_sick_type.enum).toEqual([...REPORT_SICK_TYPES, null]);
  });
});

describe('the fields the new format made available', () => {
  const person = (schema.schema as Node).properties.personnel.items;

  test('duty_type and sub_reason are separate fields', () => {
    expect(person.properties.duty_type).toBeDefined();
    expect(person.properties.sub_reason).toBeDefined();
  });

  test('an appointment time has its own field rather than being folded into text', () => {
    expect(person.properties.start_time).toBeDefined();
  });

  test('permanence is a boolean, not a magic day count', () => {
    expect(person.properties.is_permanent.type).toBe('boolean');
  });

  test('a command appointment can be recorded as vacant', () => {
    const member = (schema.schema as Node).properties.command_team.items;
    expect(member.properties.is_vacant.type).toBe('boolean');
    expect(member.properties.unit_label).toBeDefined();
  });

  test('the message can be rejected with a stated reason', () => {
    const root = (schema.schema as Node).properties;
    expect(root.rejected.type).toBe('boolean');
    expect(root.rejection_reason).toBeDefined();
  });
});
