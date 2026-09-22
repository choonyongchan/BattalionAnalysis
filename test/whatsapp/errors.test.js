/**
 * Tests for describeError: it must never leak a DrizzleQueryError's message or
 * params, since those hold the SQL text and the bound values -- a parade-state
 * body, or a rejection reason that can quote one.
 */

import { describe, expect, test } from 'bun:test';
import { describeError } from '../../whatsapp/src/errors.js';
// The real class, imported from the root install (whatsapp has no drizzle-orm of
// its own): proves describeError works against what drizzle-orm actually throws,
// not just a same-shaped stand-in.
import { DrizzleQueryError } from '../../node_modules/drizzle-orm/errors.js';

/** @type {string} A marker standing in for a name/NRIC that must never surface. */
const MARKER = 'NRIC S1234568B BODY';

describe('describeError', () => {
  test('never includes a DrizzleQueryError message or params', () => {
    const err = new DrizzleQueryError(
      'insert into raw_messages (body) values ($1)',
      [MARKER],
      new Error('fetch failed'),
    );

    expect(err.message).toContain(MARKER); // sanity: the marker really is in there.
    expect(JSON.stringify(describeError(err))).not.toContain(MARKER);
  });

  test('surfaces the cause code and message for a DrizzleQueryError, never its own message', () => {
    const cause = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    const err = new DrizzleQueryError('insert into raw_messages (body) values ($1)', [MARKER], cause);

    const described = describeError(err);
    expect(described.causeCode).toBe('ECONNREFUSED');
    expect(described.causeMessage).toBe('connection refused');
    expect(described.message).toBeUndefined();
  });

  test('treats a same-shaped object as a DrizzleQueryError even without the real class', () => {
    const err = {
      name: 'Error',
      message: `Failed query: ...\nparams: ${MARKER}`,
      query: 'insert into raw_messages (body) values ($1)',
      params: [MARKER],
      cause: { code: 'ETIMEDOUT', message: 'timed out' },
    };

    expect(JSON.stringify(describeError(err))).not.toContain(MARKER);
  });

  test('keeps message and name for an ordinary error', () => {
    const err = new Error('neon unreachable');
    expect(describeError(err)).toEqual({ name: 'Error', message: 'neon unreachable' });
  });
});
