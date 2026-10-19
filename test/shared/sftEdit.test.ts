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
} from '../../shared/sftEdit.ts';

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

/** The cleaned value of a correction expected to pass. */
function valueOf(result: ReturnType<typeof validateSftEdit>) {
  if (!result.ok) throw new Error('expected a valid edit: ' + JSON.stringify(result.errors));
  return result.value;
}

/** The field errors of a correction expected to fail. */
function errorsOf(result: ReturnType<typeof validateSftEdit>) {
  if (result.ok) throw new Error('expected the edit to be refused');
  return result.errors;
}

describe('validateSftEdit', () => {
  test('trims text, stores a blank as null, and reads the time as Singapore time', () => {
    expect(valueOf(validateSftEdit(FORM, NOW))).toEqual({
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
    expect(valueOf(validateSftEdit({ ...FORM, company: '' }, NOW)).company).toBeNull();
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
    expect(Object.keys(errorsOf(validateSftEdit({ ...FORM, ...change }, NOW)))).toEqual([field]);
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
    const value = valueOf(validateSftEdit(form, NOW));
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
