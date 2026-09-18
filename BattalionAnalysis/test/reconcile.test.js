/**
 * Tests for reconciling the two report-sick sources on soldier identity.
 *
 * The parade state and the FormSG form are filled in by different people, in different
 * name formats, and neither is authoritative. The cases worth having are the ones a
 * commander actually asks about: the soldier on the parade state who never filed the
 * form, the form with no parade-state line behind it, and the name that is spelled with
 * a nickname in one place and without it in the other.
 */

import { describe, expect, test } from 'bun:test';
import { namesMatch, nameTokens, reconcileReportSick } from '../src/model/reconcile.js';

describe('name tokens', () => {
  test('drops the rank, punctuation and one-letter tokens', () => {
    expect(nameTokens('CPL TAN JUN HAO, DARREN')).toEqual(['TAN', 'JUN', 'HAO', 'DARREN']);
    expect(nameTokens('MUHAMMAD IRFAN BIN OSMAN')).toEqual(['MUHAMMAD', 'IRFAN', 'OSMAN']);
    expect(nameTokens('')).toEqual([]);
  });
});

describe('name matching', () => {
  test('identical names match', () => {
    expect(namesMatch('TAN JUN HAO', 'TAN JUN HAO')).toBe(true);
  });

  test('a nickname on one side only still matches', () => {
    expect(namesMatch('TAN JUN HAO, DARREN', 'TAN JUN HAO')).toBe(true);
  });

  test('token order does not matter', () => {
    expect(namesMatch('TAN JOHN', 'JOHN TAN')).toBe(true);
  });

  test('a leftover rank token does not block the match', () => {
    expect(namesMatch('CPL TAN WEI', 'TAN WEI')).toBe(true);
  });

  test('same surname but different given names do not match', () => {
    expect(namesMatch('TAN WEI MING', 'TAN WEI LONG')).toBe(false);
  });

  test('a blank name never matches', () => {
    expect(namesMatch('', 'TAN WEI')).toBe(false);
    expect(namesMatch('TAN WEI', '')).toBe(false);
  });
});

describe('reconcileReportSick', () => {
  const episode = (over) => ({ key: '', name: '', fourD: '', company: 'Archer', ...over });
  const submission = (over) => ({ key: '', name: '', fourD: '', company: 'Archer', ...over });

  test('a shared 4D number is a match with nothing flagged', () => {
    const rows = reconcileReportSick(
      [episode({ key: '4D:1234', name: 'TAN AH KOW', fourD: '1234' })],
      [submission({ key: '4D:1234', name: 'TAN AH KOW', fourD: '1234' })]
    );
    expect(rows).toEqual([
      { company: 'Archer', paradeCount: 1, formsgCount: 1, matched: 1, paradeOnly: [], formsgOnly: [] },
    ]);
  });

  test('a fuzzy name match with no 4D still reconciles', () => {
    const rows = reconcileReportSick(
      [episode({ key: 'NAME:TAN JUN HAO DARREN', name: 'TAN JUN HAO, DARREN', company: 'Braves' })],
      [submission({ key: 'NAME:TAN JUN HAO', name: 'TAN JUN HAO', company: 'Braves' })]
    );
    expect(rows[0]).toMatchObject({ company: 'Braves', matched: 1, paradeOnly: [], formsgOnly: [] });
  });

  test('a soldier on the parade state with no form is flagged parade-only', () => {
    const rows = reconcileReportSick(
      [episode({ key: 'NAME:LIM WEI', name: 'LIM WEI', company: 'Cougar' })],
      []
    );
    expect(rows[0]).toMatchObject({
      company: 'Cougar',
      paradeCount: 1,
      formsgCount: 0,
      matched: 0,
      paradeOnly: ['LIM WEI'],
      formsgOnly: [],
    });
  });

  test('a form with no parade-state line is flagged formsg-only', () => {
    const rows = reconcileReportSick(
      [],
      [submission({ key: 'NAME:GOH MING', name: 'GOH MING', company: 'Cougar' })]
    );
    expect(rows[0]).toMatchObject({
      company: 'Cougar',
      paradeCount: 0,
      formsgCount: 1,
      matched: 0,
      paradeOnly: [],
      formsgOnly: ['GOH MING'],
    });
  });

  test('a submission naming no known company lands in an Unassigned row, listed last', () => {
    const rows = reconcileReportSick(
      [episode({ key: '4D:1', name: 'A B', fourD: '1', company: 'Archer' })],
      [submission({ key: 'NAME:NO COY', name: 'NO COY', company: '' })]
    );
    expect(rows.map((row) => row.company)).toEqual(['Archer', 'Unassigned']);
    expect(rows[1]).toMatchObject({ paradeCount: 0, formsgCount: 1, formsgOnly: ['NO COY'] });
  });

  test('the same soldier on two parade lines counts once', () => {
    const rows = reconcileReportSick(
      [
        episode({ key: '4D:9', name: 'ONG KAI', fourD: '9' }),
        episode({ key: '4D:9', name: 'ONG KAI', fourD: '9' }),
      ],
      []
    );
    expect(rows[0]).toMatchObject({ paradeCount: 1, paradeOnly: ['ONG KAI'] });
  });

  test('rows come back in company parade order', () => {
    const rows = reconcileReportSick(
      [
        episode({ key: '4D:1', fourD: '1', name: 'S', company: 'Stallion' }),
        episode({ key: '4D:2', fourD: '2', name: 'A', company: 'Archer' }),
      ],
      []
    );
    expect(rows.map((row) => row.company)).toEqual(['Archer', 'Stallion']);
  });
});
