/**
 * Settings storage against the Neon test branch: defaults when empty, optimistic saves, resets,
 * and a hand-broken row falling back rather than failing the read.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import type { Db } from '../../db/index.ts';
import { settings } from '../../db/schema.ts';
import { readSettings, resetSection, saveSection } from '../../lib/settings.ts';
import { DEFAULTS } from '../../src/model/settings/defaults.js';
import { DB_TIMEOUT_MS, hasTestDb, resetTestDb } from '../support/db.ts';

const UNIT = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };

describe.skipIf(!hasTestDb)('lib/settings', () => {
  let db: Db;
  beforeEach(async () => {
    db = await resetTestDb();
  }, DB_TIMEOUT_MS);

  test('an empty table reads as every default, at version 0', async () => {
    const { values, meta } = await readSettings(db);
    expect(values).toEqual(DEFAULTS);
    expect(meta.unit).toEqual({ version: 0, isDefault: true, invalid: false });
  }, DB_TIMEOUT_MS);

  test('a first save is version 1; the next save must name it and makes version 2', async () => {
    expect(await saveSection(db, 'unit', UNIT, 0)).toEqual({ status: 'saved', version: 1 });
    expect((await readSettings(db)).values.unit).toEqual(UNIT);
    expect(await saveSection(db, 'unit', { ...UNIT, name: '42 SAR' }, 1)).toEqual({ status: 'saved', version: 2 });
  }, DB_TIMEOUT_MS);

  test('a save naming a stale version is a conflict and changes nothing', async () => {
    await saveSection(db, 'unit', UNIT, 0);
    await saveSection(db, 'unit', { ...UNIT, name: '42 SAR' }, 1);
    expect(await saveSection(db, 'unit', { ...UNIT, name: 'Stale' }, 1)).toEqual({ status: 'conflict' });
    expect(await saveSection(db, 'unit', { ...UNIT, name: 'Stale' }, 0)).toEqual({ status: 'conflict' });
    expect((await readSettings(db)).values.unit.name).toBe('42 SAR');
  }, DB_TIMEOUT_MS);

  test('a reset deletes the row when the version matches, and conflicts when it does not', async () => {
    await saveSection(db, 'unit', UNIT, 0);
    expect(await resetSection(db, 'unit', 5)).toEqual({ status: 'conflict' });
    expect(await resetSection(db, 'unit', 1)).toEqual({ status: 'saved', version: 0 });
    expect((await readSettings(db)).meta.unit.isDefault).toBe(true);
    expect(await resetSection(db, 'unit', 0)).toEqual({ status: 'saved', version: 0 });
  }, DB_TIMEOUT_MS);

  test('a row broken by hand falls back to the default and is flagged', async () => {
    await db.insert(settings).values({ section: 'thresholds', value: { longMcDays: 'soon' } });
    const { values, meta } = await readSettings(db);
    expect(values.thresholds).toEqual(DEFAULTS.thresholds);
    expect(meta.thresholds.invalid).toBe(true);
  }, DB_TIMEOUT_MS);
});
