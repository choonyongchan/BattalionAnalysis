/**
 * Correcting a stored SFT record: the rules the Deposit page and `api/sft.ts` both apply.
 * NAMES ARE SYNTHETIC.
 */
import { describe, expect, test } from 'bun:test';
import {
  MAX_TEXT_CHARS,
  filterSftRows,
  toEditForm,
  toSftRows,
  validateSftEdit,
} from '../../src/model/sftEdit.js';

/** 2026-09-20 12:00 SGT, after every date used below. */
const NOW = Date.parse('2026-09-20T04:00:00.000Z');

/** A form a clerk could save as it is. */
const FORM = {
  rank: ' PTE ',
  name: 'ECHO TAN',
  company: 'Archer',
  groupIc: '3SG FOXTROT LIM',
  pesStatus: 'A',
  exercises: 'Run; Push-ups',
  sfabtType: '',
  location: 'Camp Stadium',
  submittedAt: '2026-09-18T18:30',
  informedCommander: true,
  windowConfirmed: false,
};

/** A stored record, as `GET /api/sft` lists it. */
const RECORD = {
  responseId: 'sft-a',
  timestamp: '2026-09-18T10:30:00.000Z',
  sftDate: '2026-09-18',
  rank: 'PTE',
  name: 'ECHO TAN',
  company: 'Archer',
  groupIc: '3SG FOXTROT LIM',
  pesStatus: 'A',
  exercises: 'Run; Push-ups',
  sfabtType: null,
  location: 'Camp Stadium',
  informedCommander: true,
  windowConfirmed: null,
};

describe('validateSftEdit', () => {
  test('trims text, stores a blank as null, and reads the time as Singapore time', () => {
    const result = validateSftEdit(FORM, NOW);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      rank: 'PTE',
      name: 'ECHO TAN',
      company: 'Archer',
      groupIc: '3SG FOXTROT LIM',
      pesStatus: 'A',
      exercises: 'Run; Push-ups',
      sfabtType: null,
      location: 'Camp Stadium',
      timestamp: '2026-09-18T10:30:00.000Z',
      informedCommander: true,
      windowConfirmed: false,
    });
  });

  test('a blank company is allowed and stored as null', () => {
    expect(validateSftEdit({ ...FORM, company: '' }, NOW).value.company).toBeNull();
  });

  test.each([
    ['a blank name', { name: '  ' }, 'name'],
    ['an unknown company', { company: 'Scorpion' }, 'company'],
    ['text over the cap', { location: 'x'.repeat(MAX_TEXT_CHARS + 1) }, 'location'],
    ['a non-text field', { rank: 7 }, 'rank'],
    ['an unreadable time', { submittedAt: '18/09/2026' }, 'submittedAt'],
    ['an impossible date', { submittedAt: '2026-02-30T10:00' }, 'submittedAt'],
    ['a time in the future', { submittedAt: '2026-09-21T09:00' }, 'submittedAt'],
    ['an acknowledgement that is not a tick', { windowConfirmed: 'yes' }, 'windowConfirmed'],
  ])('refuses %s', (_name, change, field) => {
    const result = validateSftEdit({ ...FORM, ...change }, NOW);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors)).toEqual([field]);
  });

  test('refuses something that is not a form at all', () => {
    expect(validateSftEdit(null, NOW).ok).toBe(false);
  });
});

describe('toEditForm', () => {
  test('is what validateSftEdit reads, so saving it unchanged changes nothing', () => {
    const form = toEditForm(RECORD);
    expect(form.submittedAt).toBe('2026-09-18T18:30');
    expect(form.sfabtType).toBe('');
    expect(form.windowConfirmed).toBe(false);
    const { value } = validateSftEdit(form, NOW);
    expect(value.timestamp).toBe(RECORD.timestamp);
    expect(value.name).toBe(RECORD.name);
  });
});

describe('toSftRows and filterSftRows', () => {
  const rows = toSftRows([
    RECORD,
    { ...RECORD, responseId: 'sft-b', name: 'GOLF ONG', company: null, groupIc: null, location: 'Camp Pool' },
  ]);

  test('shapes each record for the table', () => {
    expect(rows[0]).toMatchObject({ id: 'sft-a', date: '2026-09-18', time: '18:30', who: 'PTE ECHO TAN', company: 'Archer' });
    expect(rows[1]).toMatchObject({ company: '—', groupIc: '—' });
  });

  test('filters on name, IC, location and company, ignoring case', () => {
    expect(filterSftRows(rows, '').length).toBe(2);
    expect(filterSftRows(rows, 'golf').map((row) => row.id)).toEqual(['sft-b']);
    expect(filterSftRows(rows, 'foxtrot').map((row) => row.id)).toEqual(['sft-a']);
    expect(filterSftRows(rows, 'POOL').map((row) => row.id)).toEqual(['sft-b']);
    expect(filterSftRows(rows, 'archer').map((row) => row.id)).toEqual(['sft-a']);
  });
});
