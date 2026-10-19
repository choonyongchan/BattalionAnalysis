/**
 * Validates a settings section; runs in the form and again on the server before a save.
 * Errors block a save and carry the field path (`holidays.1.name`); warnings do not block.
 */

import { rotationIssues } from '../rotations.ts';
import type { SectionName, SettingsValues } from './defaults.ts';

/** A message tied to one field's path. */
export interface FieldMessage {
  path: string;
  message: string;
}

type Fields = Record<string, unknown>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Longest logo data URL (~200 KB of image); the logo travels with every dashboard read. */
export const MAX_LOGO_CHARS = 280000;

/** Whether a value is a real `yyyy-MM-dd` date (false for `2026-02-30`). */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Trimmed text; anything not a string reads as blank. */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Collects field errors for one section. */
class Collector {
  readonly errors: FieldMessage[] = [];

  /** Records `message` unless the text is 1 to `max` characters. */
  text(path: string, value: string, max: number, message: string): void {
    if (value === '' || value.length > max) this.errors.push({ path, message });
  }

  /** Records an error unless the value is a whole number in `[min, max]`. */
  int(path: string, value: unknown, min: number, max: number): void {
    if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
      this.errors.push({ path, message: `Enter a whole number from ${min} to ${max}.` });
    }
  }

  /** Records an error unless the value is a real date. */
  date(path: string, value: string): void {
    if (!isIsoDate(value)) this.errors.push({ path, message: 'Enter a date.' });
  }

  /** The value as a list of objects, or [] with an error when it is not a list. */
  list(path: string, value: unknown): Fields[] {
    if (Array.isArray(value)) return value.map((item) => (item && typeof item === 'object' ? item : {}) as Fields);
    this.errors.push({ path, message: 'Must be a list.' });
    return [];
  }

  /** Records `message` at every repeat of an earlier key. */
  repeats(keys: string[], path: (index: number) => string, message: string): void {
    keys.forEach((key, index) => {
      if (keys.indexOf(key) !== index) this.errors.push({ path: path(index), message });
    });
  }
}

/** Validates the `unit` section. */
function unit(value: Fields, check: Collector): SettingsValues['unit'] {
  const name = textOf(value.name);
  const pageTitle = textOf(value.pageTitle);
  const logo = textOf(value.logo);
  check.text('name', name, 40, 'Enter a unit name of 1 to 40 characters.');
  check.text('pageTitle', pageTitle, 80, 'Enter a page title of 1 to 80 characters.');
  if (logo !== '' && (!LOGO_DATA_URL.test(logo) || logo.length > MAX_LOGO_CHARS)) {
    check.errors.push({ path: 'logo', message: 'Upload a PNG, JPEG, WebP or SVG image of 200 KB or less.' });
  }
  return { name, pageTitle, logo };
}

/** Validates the `calendar` section; both lists come back sorted. */
function calendar(value: Fields, check: Collector, warnings: FieldMessage[]): SettingsValues['calendar'] {
  const holidays = check.list('holidays', value.holidays).map((holiday, index) => {
    const date = textOf(holiday.date);
    const name = textOf(holiday.name);
    check.date(`holidays.${index}.date`, date);
    check.text(`holidays.${index}.name`, name, 80, "Enter the holiday's name.");
    return { date, name };
  });
  check.repeats(holidays.map((holiday) => holiday.date), (i) => `holidays.${i}.date`, 'This date is listed twice.');

  const rotations = check.list('rotations', value.rotations).map((rotation, index) => {
    const name = textOf(rotation.name);
    const start = textOf(rotation.start);
    const end = textOf(rotation.end);
    check.text(`rotations.${index}.name`, name, 40, "Enter the rotation's name.");
    check.date(`rotations.${index}.start`, start);
    check.date(`rotations.${index}.end`, end);
    if (isIsoDate(start) && isIsoDate(end) && start > end) {
      check.errors.push({ path: `rotations.${index}.end`, message: 'Ends before it starts.' });
    }
    return { name, start, end };
  });
  check.repeats(
    rotations.map((rotation) => rotation.name + '|' + rotation.start),
    (i) => `rotations.${i}.name`,
    'Another rotation has this name and start date.',
  );

  if (check.errors.length === 0) {
    rotationIssues(rotations).forEach((issue) => warnings.push({ path: 'rotations', message: issue.message }));
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  rotations.sort((a, b) => a.start.localeCompare(b.start));
  return { holidays, rotations };
}

/** Validates the `thresholds` section. */
function thresholds(value: Fields, check: Collector): SettingsValues['thresholds'] {
  check.int('longMcDays', value.longMcDays, 1, 365);
  check.int('leaderboardSize', value.leaderboardSize, 1, 100);
  return { longMcDays: value.longMcDays as number, leaderboardSize: value.leaderboardSize as number };
}

/** Validates the `session` section. */
function session(value: Fields, check: Collector): SettingsValues['session'] {
  check.int('ttlHours', value.ttlHours, 1, 72);
  check.int('refreshSeconds', value.refreshSeconds, 15, 3600);
  return { ttlHours: value.ttlHours as number, refreshSeconds: value.refreshSeconds as number };
}

const VALIDATORS: { [S in SectionName]: (value: Fields, check: Collector, warnings: FieldMessage[]) => SettingsValues[S] } = {
  unit,
  calendar,
  thresholds,
  session,
};

/** The result of validating one section; `value` is cleaned and null when there are errors. */
export interface SectionCheck<S extends SectionName = SectionName> {
  value: SettingsValues[S] | null;
  errors: FieldMessage[];
  warnings: FieldMessage[];
}

/** Validates and cleans one section (known keys only, text trimmed, lists sorted). */
export function validateSection<S extends SectionName>(section: S, value: unknown): SectionCheck<S>;
export function validateSection(section: string, value: unknown): SectionCheck;
export function validateSection(section: string, value: unknown): SectionCheck {
  const validator = VALIDATORS[section as SectionName];
  if (!validator) {
    return { value: null, errors: [{ path: '', message: `Unknown settings section "${section}".` }], warnings: [] };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value: null, errors: [{ path: '', message: 'Must be an object.' }], warnings: [] };
  }
  const check = new Collector();
  const warnings: FieldMessage[] = [];
  const cleaned = validator(value as Fields, check, warnings);
  return { value: check.errors.length === 0 ? cleaned : null, errors: check.errors, warnings };
}

/** The first error message for a field, or ''. */
export function errorAt(errors: FieldMessage[] | null | undefined, path: string): string {
  return errors?.find((error) => error.path === path)?.message ?? '';
}
