# User Settings, Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store user-editable settings in a `settings` table, gate edits behind a new read-write `SETTINGS_PASSWORD`, and ship the Settings page's Basic/Advanced editor with the `unit`, `calendar`, `thresholds` and `session` sections.

**Architecture:** One `settings` row per section (JSONB, optimistic `version`). Pure defaults, validation and resolution live in `src/model/settings/` (JavaScript, shared by browser and server, as `lib/dashboard.ts` already imports `src/model/domain.js`); database access lives in `lib/settings.ts`. `/api/dashboard` returns the resolved settings with the tabs; a new `/api/settings` saves and resets sections for a caller holding the `settings_session` cookie. `public_holidays` and `rotations` move into the `calendar` section and are dropped.

**Tech Stack:** Bun (tests, scripts), TypeScript on the server, Preact + Vite + `@preact/signals` in the browser, Drizzle ORM over `neon-http`, Vercel Functions.

**Spec:** `docs/superpowers/specs/2026-09-24-user-settings-design.md` (Phase 1 of 4). Read it and `docs/architecture_patterns.md` before starting.

## Global Constraints

- Use `bun` for everything: `bun test ./test/`, `bun run build`, `bun run db:generate`. Never `npm`/`npx`.
- Google-style docstrings (TypeScript) / JSDoc (JavaScript) on every function, class and exported constant, matching the surrounding files' density and voice.
- An empty `settings` table must behave exactly as today: defaults equal today's values (`unit.name` "40 SAR", `unit.pageTitle` "40 SAR Personnel", `thresholds.longMcDays` 14, `thresholds.leaderboardSize` 10, `session.ttlHours` 12, `session.refreshSeconds` 60).
- `DASHBOARD_PASSWORD` is read-only for settings; Deposit keeps working on it unchanged. `SETTINGS_PASSWORD` is read-write. Unset `SETTINGS_PASSWORD`, or one equal to `DASHBOARD_PASSWORD`, means no one can edit settings (fail closed).
- Nothing logs a setting's value; log the section name only.
- `src/model/` stays pure (no DOM, no network) and imports only `src/model/`. `src/app/` imports only `data/` and `theme/`.
- `neon-http` has no interactive transactions: each write is one statement.
- Every colour comes from a token in `src/theme/tokens.css`; add no raw colours.
- Commit after each task on a feature branch (`git checkout -b settings-phase-1` before Task 1). End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files the task names: the working tree has unrelated uncommitted changes (`lib/parser/prompt.ts`, `whatsapp/…`) that must not be swept in.

## Review Focus

1. `SETTINGS_PASSWORD` set equal to `DASHBOARD_PASSWORD` → the login grants read-only, and `/api/settings` answers 503; nobody gains edit rights (Tasks 5 and 6).
2. A `settings` row hand-edited in SQL into an invalid shape → that section falls back to defaults, the dashboard still loads, and the Settings page marks the section invalid (Tasks 2, 3, 9).
3. Two admins saving the same section from stale pages → the second gets 409 and nothing is silently overwritten (Tasks 3 and 6).
4. The settings read failing while logging in → the login still succeeds with the default 12-hour session (Task 5).
5. A logo that is too large or not an image → a field error and no save (Task 1).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/model/settings/defaults.js` | create | Section registry and default values |
| `src/model/settings/validate.js` | create | Per-section validation, cleaning, `errorAt` |
| `src/model/settings/resolve.js` | create | Stored rows + defaults → `{values, meta}` |
| `src/model/settings/active.js` | create | The browser's active settings (`settingOf`) |
| `db/schema.ts` | modify | Add `settings`; later drop `publicHolidays`, `rotations` |
| `db/migrations/0002_settings.sql` (+ meta) | create | Create `settings`, copy calendar rows |
| `db/migrations/0003_drop_old_settings_tables.sql` (+ meta) | create | Drop the two old tables |
| `lib/settings.ts` | create | `readSettings`, `saveSection`, `resetSection` |
| `lib/session.ts` | modify | `SETTINGS_COOKIE`, named cookies, `editSecret`, `hasSettingsSession` |
| `api/session.ts` | modify | Two passwords, `canEdit`, TTL from settings |
| `api/dashboard.ts` | modify | Returns `settings` and `canEdit` |
| `api/settings.ts` | create | PUT/DELETE a section |
| `lib/dashboard.ts`, `src/data/tabs.js` | modify | Drop the Holidays/Rotations tabs |
| `src/data/feed.js` | modify | Read settings, derive holidays/rotations, set active settings |
| `src/data/settings.js` | create | Browser calls to `/api/settings`; `unitSettings`, `refreshMs` |
| `src/data/session.js` | modify | `startSession` returns `canEdit`; `unlockEditing` |
| `src/app/auth.js` | modify | Refresh interval from settings |
| `src/model/calendarMarks.js` | modify | Remove the hardcoded Singapore map |
| `src/app/Logo.jsx`, `Sidebar.jsx`, `Shell.jsx`, `src/model/orbat.js`, `src/pages/Orbat.jsx`, `src/pages/Deposit.jsx` | modify | Unit name / logo / page title from settings |
| `src/pages/shared/category.jsx`, `src/model/leaderboards.js`, `src/model/formsg.js` | modify | Thresholds from settings |
| `src/pages/Settings.jsx` | modify | Basic/Advanced tabs |
| `src/pages/settings/SectionCard.jsx`, `editors.jsx`, `UnlockPanel.jsx` | create | Section card, editors, unlock |
| `src/theme/components.css` | modify | Form styles |
| `scripts/import-sheet.ts` | modify | Stop importing holidays/rotations |
| `db/grants-dashboard.sql` | modify | `SELECT` on `settings` |
| `db/seed-public-holidays.sql` | delete | Replaced by the Calendar editor |
| `test/support/db.ts`, `test/support/app.ts` | modify | New table; serve `/api/settings` |
| `.env.example`, `docs/architecture_patterns.md`, `docs/dashboard.md`, `tasks/todo.md` | modify | Docs and rollout |

---

### Task 1: Section registry, defaults and validation

**Files:**
- Create: `src/model/settings/defaults.js`
- Create: `src/model/settings/validate.js`
- Test: `test/dashboard/settings-validate.test.js`

**Interfaces:**
- Consumes: `rotationIssues(rotations)` from `src/model/rotations.js` (takes `{name, start, end}` objects, returns `{kind, message}[]`).
- Produces:
  - `SECTIONS: Array<{name: string, tier: 'basic'|'advanced', label: string}>`
  - `DEFAULTS: Object<string, Object>`, `isSection(name: string): boolean`, `defaultOf(section: string): Object` (a deep copy)
  - `validateSection(section: string, value: *): {value: ?Object, errors: Array<{path: string, message: string}>, warnings: Array<{path: string, message: string}>}`; `value` is the cleaned value when there are no errors, else `null`
  - `errorAt(errors, path: string): string` (the first message at exactly that path, or `''`)
  - `MAX_LOGO_CHARS = 280000`

- [ ] **Step 1: Write the failing tests**

Create `test/dashboard/settings-validate.test.js`:

```js
/**
 * Settings validation: what a person can save, and the sentence they read when they cannot.
 *
 * Every default must validate clean, or an untouched deployment would refuse its own settings.
 * The rest pins one refusal per rule, by the field path the Settings page shows it beside.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULTS, SECTIONS, defaultOf, isSection } from '../../src/model/settings/defaults.js';
import { MAX_LOGO_CHARS, errorAt, validateSection } from '../../src/model/settings/validate.js';

/**
 * Validates a section built from its defaults with some fields replaced.
 * @param {string} section The section.
 * @param {!Object} patch Fields to replace.
 * @returns {!Object} The validation result.
 */
function withPatch(section, patch) {
  return validateSection(section, { ...defaultOf(section), ...patch });
}

describe('defaults', () => {
  test('every section has a default, and every default validates clean', () => {
    for (const { name } of SECTIONS) {
      const result = validateSection(name, defaultOf(name));
      expect(result.errors).toEqual([]);
      expect(result.value).toEqual(DEFAULTS[name]);
    }
  });

  test('the defaults are today\'s hardcoded values', () => {
    expect(DEFAULTS.unit).toEqual({ name: '40 SAR', pageTitle: '40 SAR Personnel', logo: '' });
    expect(DEFAULTS.thresholds).toEqual({ longMcDays: 14, leaderboardSize: 10 });
    expect(DEFAULTS.session).toEqual({ ttlHours: 12, refreshSeconds: 60 });
    expect(DEFAULTS.calendar).toEqual({ holidays: [], rotations: [] });
  });

  test('defaultOf returns a copy, so editing it cannot change the defaults', () => {
    const copy = defaultOf('calendar');
    copy.holidays.push({ date: '2026-08-09', name: 'National Day' });
    expect(DEFAULTS.calendar.holidays).toEqual([]);
  });

  test('Basic holds unit, calendar and thresholds; Advanced holds session', () => {
    const tierOf = Object.fromEntries(SECTIONS.map((s) => [s.name, s.tier]));
    expect(tierOf).toEqual({ unit: 'basic', calendar: 'basic', thresholds: 'basic', session: 'advanced' });
    expect(isSection('unit')).toBe(true);
    expect(isSection('parser')).toBe(false);
  });
});

describe('validateSection', () => {
  test('an unknown section, or a value that is not an object, is refused', () => {
    expect(validateSection('nope', {}).errors[0].message).toContain('Unknown');
    expect(validateSection('unit', null).errors).toEqual([{ path: '', message: 'Must be an object.' }]);
    expect(validateSection('unit', []).errors).toEqual([{ path: '', message: 'Must be an object.' }]);
  });

  test('unit: a blank name or page title is refused; text is trimmed', () => {
    expect(errorAt(withPatch('unit', { name: '  ' }).errors, 'name')).not.toBe('');
    expect(errorAt(withPatch('unit', { pageTitle: '' }).errors, 'pageTitle')).not.toBe('');
    expect(withPatch('unit', { name: ' 41 SAR ' }).value.name).toBe('41 SAR');
  });

  test('unit: a logo must be an image data URL within the size limit', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(withPatch('unit', { logo: png }).errors).toEqual([]);
    expect(errorAt(withPatch('unit', { logo: 'https://example.com/a.png' }).errors, 'logo')).not.toBe('');
    expect(errorAt(withPatch('unit', { logo: 'data:text/html;base64,PGgxPg==' }).errors, 'logo')).not.toBe('');
    const huge = 'data:image/png;base64,' + 'A'.repeat(MAX_LOGO_CHARS);
    expect(errorAt(withPatch('unit', { logo: huge }).errors, 'logo')).not.toBe('');
  });

  test('calendar: holidays need a real date and a name, once each, and come back sorted', () => {
    const bad = validateSection('calendar', {
      holidays: [
        { date: '2026-02-30', name: 'Not a day' },
        { date: '2026-08-09', name: '' },
      ],
      rotations: [],
    });
    expect(errorAt(bad.errors, 'holidays.0.date')).not.toBe('');
    expect(errorAt(bad.errors, 'holidays.1.name')).not.toBe('');

    const twice = validateSection('calendar', {
      holidays: [
        { date: '2026-08-09', name: 'National Day' },
        { date: '2026-08-09', name: 'Again' },
      ],
      rotations: [],
    });
    expect(errorAt(twice.errors, 'holidays.1.date')).toBe('This date is listed twice.');

    const sorted = validateSection('calendar', {
      holidays: [
        { date: '2026-12-25', name: 'Christmas Day' },
        { date: '2026-01-01', name: "New Year's Day" },
      ],
      rotations: [],
    });
    expect(sorted.value.holidays.map((h) => h.date)).toEqual(['2026-01-01', '2026-12-25']);
  });

  test('calendar: a rotation that ends before it starts is an error; gaps and overlaps only warn', () => {
    const reversed = validateSection('calendar', {
      holidays: [],
      rotations: [{ name: 'Rot 1', start: '2026-09-30', end: '2026-07-01' }],
    });
    expect(errorAt(reversed.errors, 'rotations.0.end')).toBe('Ends before it starts.');

    const overlapping = validateSection('calendar', {
      holidays: [],
      rotations: [
        { name: 'Rot 1', start: '2026-07-01', end: '2026-08-15' },
        { name: 'Rot 2', start: '2026-08-01', end: '2026-09-30' },
      ],
    });
    expect(overlapping.errors).toEqual([]);
    expect(overlapping.warnings.map((w) => w.path)).toEqual(['rotations']);
    expect(overlapping.warnings[0].message).toContain('overlap');
  });

  test('calendar: a missing list is an error, not a silent empty list', () => {
    expect(errorAt(validateSection('calendar', { rotations: [] }).errors, 'holidays')).toBe('Must be a list.');
  });

  test('thresholds and session: whole numbers within bounds', () => {
    expect(errorAt(withPatch('thresholds', { longMcDays: 0 }).errors, 'longMcDays')).not.toBe('');
    expect(errorAt(withPatch('thresholds', { leaderboardSize: 2.5 }).errors, 'leaderboardSize')).not.toBe('');
    expect(errorAt(withPatch('thresholds', { leaderboardSize: '10' }).errors, 'leaderboardSize')).not.toBe('');
    expect(errorAt(withPatch('session', { ttlHours: 73 }).errors, 'ttlHours')).not.toBe('');
    expect(errorAt(withPatch('session', { refreshSeconds: 14 }).errors, 'refreshSeconds')).not.toBe('');
    expect(withPatch('session', { ttlHours: 72, refreshSeconds: 15 }).errors).toEqual([]);
  });

  test('unknown keys are dropped from the cleaned value', () => {
    expect(withPatch('thresholds', { surprise: 1 }).value).toEqual({ longMcDays: 14, leaderboardSize: 10 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/dashboard/settings-validate.test.js`
Expected: FAIL, `Cannot find module '../../src/model/settings/defaults.js'`.

- [ ] **Step 3: Write `src/model/settings/defaults.js`**

```js
/**
 * The settings a person can change on the Settings page, and what each is until they do.
 *
 * One entry per section, one `settings` row per section in Neon. A section with no row is its
 * default here, which is why every default equals the value the code hardcoded before
 * settings existed: an untouched deployment behaves exactly as it always did.
 *
 * `tier` decides the tab: Basic is what a new batch or battalion sets up; Advanced changes how
 * messages and forms are read, or how the dashboard runs. Later phases add sections here.
 *
 * Shared by the browser and the server (`lib/settings.ts`), so it must stay pure.
 */

/**
 * Every section, in the order the Settings page shows them within a tab.
 * @type {!Array<{name: string, tier: string, label: string}>}
 */
export const SECTIONS = [
  { name: 'unit', tier: 'basic', label: 'Unit' },
  { name: 'calendar', tier: 'basic', label: 'Calendar' },
  { name: 'thresholds', tier: 'basic', label: 'Thresholds' },
  { name: 'session', tier: 'advanced', label: 'Session' },
];

/**
 * Each section's value when nobody has saved one.
 *
 * `longMcDays` is the shortest MC that counts as long-term (the page used to hardcode "more
 * than 13"). Holidays and rotations start empty: which days they are is the battalion's to say.
 * @type {!Object<string, !Object>}
 */
export const DEFAULTS = {
  unit: { name: '40 SAR', pageTitle: '40 SAR Personnel', logo: '' },
  calendar: { holidays: [], rotations: [] },
  thresholds: { longMcDays: 14, leaderboardSize: 10 },
  session: { ttlHours: 12, refreshSeconds: 60 },
};

/**
 * Whether a name is a known section.
 * @param {*} name A section name from a request or a stored row.
 * @returns {boolean} True for a section in `SECTIONS`.
 */
export function isSection(name) {
  return SECTIONS.some((section) => section.name === name);
}

/**
 * A section's default, as a copy the caller may change.
 * @param {string} section A section name from `SECTIONS`.
 * @returns {!Object} A deep copy of its default.
 */
export function defaultOf(section) {
  return structuredClone(DEFAULTS[section]);
}
```

- [ ] **Step 4: Write `src/model/settings/validate.js`**

```js
/**
 * What makes a settings value savable, and the sentence to show beside a field when it is not.
 *
 * The browser runs this before sending, so a mistake is caught while the form is open; the
 * server runs the same code before writing, so a hand-crafted request cannot store what the
 * form would refuse. Errors block a save. Warnings do not: a gap between rotations is worth
 * knowing about, but it is not wrong.
 *
 * Each error carries the path of the field it belongs to (`holidays.1.name`), so the page can
 * put it next to that field rather than in a list at the top.
 *
 * Every function here is pure.
 */

import { rotationIssues } from '../rotations.js';

/** @type {!RegExp} An ISO `yyyy-MM-dd` date. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @type {!RegExp} An inline image the browser can show as a logo. */
const LOGO_DATA_URL = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/**
 * Longest logo data URL accepted: about 200 KB of image once base64's 4/3 overhead is removed.
 * The logo travels with every dashboard read, so it is kept small.
 * @type {number}
 */
export const MAX_LOGO_CHARS = 280000;

/**
 * Whether a value is a real calendar date written as ISO `yyyy-MM-dd`.
 * @param {*} value The candidate.
 * @returns {boolean} False for `2026-02-30` as well as for non-strings.
 */
function isIsoDate_(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    return false;
  }
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * A text field, trimmed; anything that is not a string reads as blank.
 * @param {*} value The raw field.
 * @returns {string} The trimmed text.
 */
function text_(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Records an error unless the text is 1 to `max` characters long.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {string} path The field's path.
 * @param {string} value The trimmed text.
 * @param {number} max Longest allowed length.
 * @param {string} message What to say when it is out of bounds.
 * @returns {void}
 */
function requireText_(errors, path, value, max, message) {
  if (value === '' || value.length > max) {
    errors.push({ path, message });
  }
}

/**
 * Records an error unless the value is a whole number within bounds.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {string} path The field's path.
 * @param {*} value The raw field.
 * @param {number} min Smallest allowed.
 * @param {number} max Largest allowed.
 * @returns {void}
 */
function requireInt_(errors, path, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push({ path, message: 'Enter a whole number from ' + min + ' to ' + max + '.' });
  }
}

/**
 * A field that must be a list; records an error and reads as empty when it is not.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {string} path The field's path.
 * @param {*} value The raw field.
 * @returns {!Array<*>} The list, or [].
 */
function listOf_(errors, path, value) {
  if (!Array.isArray(value)) {
    errors.push({ path, message: 'Must be a list.' });
    return [];
  }
  return value;
}

/**
 * The positions of every repeat of an earlier key.
 * @param {!Array<string>} keys One key per list item.
 * @returns {!Array<number>} Indexes of the second and later occurrences.
 */
function repeats_(keys) {
  const seen = new Set();
  const repeated = [];
  keys.forEach((key, index) => {
    if (seen.has(key)) {
      repeated.push(index);
    }
    seen.add(key);
  });
  return repeated;
}

/**
 * Validates the `unit` section.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @returns {!Object} The cleaned section.
 */
function unit_(value, errors) {
  const name = text_(value.name);
  const pageTitle = text_(value.pageTitle);
  const logo = typeof value.logo === 'string' ? value.logo.trim() : '';
  requireText_(errors, 'name', name, 40, 'Enter a unit name of 1 to 40 characters.');
  requireText_(errors, 'pageTitle', pageTitle, 80, 'Enter a page title of 1 to 80 characters.');
  if (logo !== '' && (!LOGO_DATA_URL.test(logo) || logo.length > MAX_LOGO_CHARS)) {
    errors.push({ path: 'logo', message: 'Upload a PNG, JPEG, WebP or SVG image of 200 KB or less.' });
  }
  return { name, pageTitle, logo };
}

/**
 * Validates the `calendar` section: holidays by date, rotations by start.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @param {!Array<!Object>} warnings Collects warnings.
 * @returns {!Object} The cleaned section, both lists sorted.
 */
function calendar_(value, errors, warnings) {
  const holidays = listOf_(errors, 'holidays', value.holidays).map((holiday, index) => {
    const date = text_(holiday && holiday.date);
    const name = text_(holiday && holiday.name);
    if (!isIsoDate_(date)) {
      errors.push({ path: 'holidays.' + index + '.date', message: 'Enter a date.' });
    }
    requireText_(errors, 'holidays.' + index + '.name', name, 80, 'Enter the holiday\'s name.');
    return { date, name };
  });
  repeats_(holidays.map((holiday) => holiday.date)).forEach((index) => {
    errors.push({ path: 'holidays.' + index + '.date', message: 'This date is listed twice.' });
  });

  const rotations = listOf_(errors, 'rotations', value.rotations).map((rotation, index) => {
    const name = text_(rotation && rotation.name);
    const start = text_(rotation && rotation.start);
    const end = text_(rotation && rotation.end);
    requireText_(errors, 'rotations.' + index + '.name', name, 40, 'Enter the rotation\'s name.');
    if (!isIsoDate_(start)) {
      errors.push({ path: 'rotations.' + index + '.start', message: 'Enter a date.' });
    }
    if (!isIsoDate_(end)) {
      errors.push({ path: 'rotations.' + index + '.end', message: 'Enter a date.' });
    } else if (isIsoDate_(start) && start > end) {
      errors.push({ path: 'rotations.' + index + '.end', message: 'Ends before it starts.' });
    }
    return { name, start, end };
  });
  repeats_(rotations.map((rotation) => rotation.name + '|' + rotation.start)).forEach((index) => {
    errors.push({ path: 'rotations.' + index + '.name', message: 'Another rotation has this name and start date.' });
  });

  if (errors.length === 0) {
    rotationIssues(rotations).forEach((issue) => warnings.push({ path: 'rotations', message: issue.message }));
  }
  holidays.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  rotations.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { holidays, rotations };
}

/**
 * Validates the `thresholds` section.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @returns {!Object} The cleaned section.
 */
function thresholds_(value, errors) {
  requireInt_(errors, 'longMcDays', value.longMcDays, 1, 365);
  requireInt_(errors, 'leaderboardSize', value.leaderboardSize, 1, 100);
  return { longMcDays: value.longMcDays, leaderboardSize: value.leaderboardSize };
}

/**
 * Validates the `session` section.
 * @param {!Object} value The raw section.
 * @param {!Array<!Object>} errors Collects errors.
 * @returns {!Object} The cleaned section.
 */
function session_(value, errors) {
  requireInt_(errors, 'ttlHours', value.ttlHours, 1, 72);
  requireInt_(errors, 'refreshSeconds', value.refreshSeconds, 15, 3600);
  return { ttlHours: value.ttlHours, refreshSeconds: value.refreshSeconds };
}

/** @type {!Object<string, function(!Object, !Array<!Object>, !Array<!Object>): !Object>} */
const VALIDATORS = { unit: unit_, calendar: calendar_, thresholds: thresholds_, session: session_ };

/**
 * Validates and cleans one section's value.
 * @param {string} section The section name.
 * @param {*} value The value to check, from the form or a stored row.
 * @returns {{value: ?Object, errors: !Array<{path: string, message: string}>,
 *     warnings: !Array<{path: string, message: string}>}} The cleaned value (only known keys,
 *     text trimmed, lists sorted) when there are no errors, else null.
 */
export function validateSection(section, value) {
  const validator = VALIDATORS[section];
  if (!validator) {
    return { value: null, errors: [{ path: '', message: 'Unknown settings section "' + section + '".' }], warnings: [] };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { value: null, errors: [{ path: '', message: 'Must be an object.' }], warnings: [] };
  }
  const errors = [];
  const warnings = [];
  const cleaned = validator(value, errors, warnings);
  return { value: errors.length === 0 ? cleaned : null, errors, warnings };
}

/**
 * The first error message for one field, for the form to show beside it.
 * @param {!Array<{path: string, message: string}>} errors Errors from `validateSection`.
 * @param {string} path The field's path.
 * @returns {string} The message, or '' when the field has none.
 */
export function errorAt(errors, path) {
  const found = (errors || []).find((error) => error.path === path);
  return found ? found.message : '';
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/dashboard/settings-validate.test.js`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add src/model/settings/defaults.js src/model/settings/validate.js test/dashboard/settings-validate.test.js
git commit -m "feat(settings): section registry, defaults and validation"
```

---

### Task 2: Resolving stored rows, and the browser's active settings

**Files:**
- Create: `src/model/settings/resolve.js`
- Create: `src/model/settings/active.js`
- Test: `test/dashboard/settings-resolve.test.js`

**Interfaces:**
- Consumes: `SECTIONS`, `defaultOf`, `validateSection` (Task 1).
- Produces:
  - `resolveSettings(rows: Array<{section: string, value: *, version: number}>): {values: Object<string, Object>, meta: Object<string, {version: number, isDefault: boolean, invalid: boolean}>}`: `version` is 0 for a section with no row
  - `defaultSettings(): Object<string, Object>`
  - `setActiveSettings(values: ?Object): void`, `resetActiveSettings(): void`, `settingOf(section: string): Object`

- [ ] **Step 1: Write the failing tests**

Create `test/dashboard/settings-resolve.test.js`:

```js
/**
 * Stored settings over the defaults: a section nobody saved is its default, and a stored
 * section that no longer validates (hand-edited in SQL, say) falls back rather than breaking
 * the dashboard.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULTS } from '../../src/model/settings/defaults.js';
import { defaultSettings, resolveSettings } from '../../src/model/settings/resolve.js';
import { resetActiveSettings, setActiveSettings, settingOf } from '../../src/model/settings/active.js';

describe('resolveSettings', () => {
  test('no rows: every section is its default, at version 0', () => {
    const { values, meta } = resolveSettings([]);
    expect(values).toEqual(DEFAULTS);
    expect(meta.unit).toEqual({ version: 0, isDefault: true, invalid: false });
  });

  test('a stored section replaces its default and carries its version', () => {
    const { values, meta } = resolveSettings([
      { section: 'unit', value: { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' }, version: 3 },
    ]);
    expect(values.unit.name).toBe('41 SAR');
    expect(meta.unit).toEqual({ version: 3, isDefault: false, invalid: false });
    expect(values.session).toEqual(DEFAULTS.session);
  });

  test('an invalid stored section falls back to its default and is flagged', () => {
    const { values, meta } = resolveSettings([{ section: 'thresholds', value: { longMcDays: 'soon' }, version: 2 }]);
    expect(values.thresholds).toEqual(DEFAULTS.thresholds);
    expect(meta.thresholds).toEqual({ version: 2, isDefault: false, invalid: true });
  });

  test('a row for a section this build does not know is ignored', () => {
    expect(Object.keys(resolveSettings([{ section: 'future', value: {}, version: 1 }]).values).sort()).toEqual(
      Object.keys(DEFAULTS).sort()
    );
  });
});

describe('active settings', () => {
  afterEach(() => resetActiveSettings());

  test('before any are set, a section reads as its default', () => {
    expect(settingOf('thresholds')).toEqual(DEFAULTS.thresholds);
  });

  test('once set, a section reads as set; reset returns to the defaults', () => {
    setActiveSettings({ ...defaultSettings(), thresholds: { longMcDays: 7, leaderboardSize: 5 } });
    expect(settingOf('thresholds').leaderboardSize).toBe(5);
    resetActiveSettings();
    expect(settingOf('thresholds').leaderboardSize).toBe(10);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/dashboard/settings-resolve.test.js`
Expected: FAIL, `Cannot find module '../../src/model/settings/resolve.js'`.

- [ ] **Step 3: Write `src/model/settings/resolve.js`**

```js
/**
 * Stored settings rows laid over the defaults: the settings in force.
 *
 * A section with no row is its default. A row that no longer validates, because someone
 * edited it in SQL or an older build wrote a shape this one refuses, is also its default,
 * and is flagged `invalid` so the Settings page can say so. A bad row must not take the
 * dashboard down with it.
 *
 * Every function here is pure.
 */

import { SECTIONS, defaultOf } from './defaults.js';
import { validateSection } from './validate.js';

/**
 * Resolves every section from the stored rows.
 * @param {Array<{section: string, value: *, version: number}>} rows The `settings` table.
 * @returns {{values: !Object<string, !Object>, meta: !Object<string, {version: number,
 *     isDefault: boolean, invalid: boolean}>}} The value in force per section, and per
 *     section the stored version (0 when no row), whether it is the default, and whether a
 *     stored row was refused.
 */
export function resolveSettings(rows) {
  const bySection = new Map((rows || []).map((row) => [row.section, row]));
  const values = {};
  const meta = {};
  SECTIONS.forEach(({ name }) => {
    const row = bySection.get(name);
    if (!row) {
      values[name] = defaultOf(name);
      meta[name] = { version: 0, isDefault: true, invalid: false };
      return;
    }
    const checked = validateSection(name, row.value);
    const invalid = checked.errors.length > 0;
    values[name] = invalid ? defaultOf(name) : checked.value;
    meta[name] = { version: row.version, isDefault: false, invalid };
  });
  return { values, meta };
}

/**
 * Every section at its default.
 * @returns {!Object<string, !Object>} Section name to default value.
 */
export function defaultSettings() {
  return resolveSettings([]).values;
}
```

- [ ] **Step 4: Write `src/model/settings/active.js`**

```js
/**
 * The settings the dashboard is running with, for model code that has no settings argument.
 *
 * Settings arrive with every dashboard read (`data/feed.js` sets them here). Threading a
 * `settings` parameter through every model function and every page that calls one would touch
 * dozens of signatures for no gain in a browser that runs one dashboard at a time. So model
 * code asks `settingOf(section)`, and gets the default until the first read lands.
 *
 * Server code must never use this: requests run concurrently there, so the server passes
 * settings explicitly (`lib/settings.ts`). Tests that set it reset it afterwards.
 */

import { defaultSettings } from './resolve.js';

/** @type {!Object<string, !Object>} Every section at its default, computed once. */
const DEFAULTS_IN_FORCE = defaultSettings();

/** @type {?Object<string, !Object>} The settings from the latest dashboard read, if any. */
let active = null;

/**
 * Replaces the active settings.
 * @param {?Object<string, !Object>} values Resolved values per section, or null for defaults.
 * @returns {void}
 */
export function setActiveSettings(values) {
  active = values || null;
}

/**
 * Returns to the defaults.
 * @returns {void}
 */
export function resetActiveSettings() {
  active = null;
}

/**
 * One section of the active settings.
 * @param {string} section A section name.
 * @returns {!Object} The section in force; callers must not change it.
 */
export function settingOf(section) {
  return (active && active[section]) || DEFAULTS_IN_FORCE[section];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test test/dashboard/settings-resolve.test.js test/dashboard/settings-validate.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/model/settings/resolve.js src/model/settings/active.js test/dashboard/settings-resolve.test.js
git commit -m "feat(settings): resolve stored rows over defaults; active settings for the browser"
```

---

### Task 3: The `settings` table and its database access

**Files:**
- Modify: `db/schema.ts` (add the `settings` table and the `jsonb` import)
- Create: `db/migrations/0002_settings.sql` and its `meta/0002_snapshot.json` + journal entry (generated)
- Create: `lib/settings.ts`
- Modify: `test/support/db.ts` (add `'settings'` to `TABLES`)
- Test: `test/lib/settings.test.ts`

**Interfaces:**
- Consumes: `resolveSettings` (Task 2).
- Produces:
  - `settings` Drizzle table: `section text PK`, `value jsonb NOT NULL`, `version integer NOT NULL DEFAULT 1`, `updated_at timestamptz NOT NULL DEFAULT now()`
  - `type ResolvedSettings = { values: Record<string, Record<string, unknown>>; meta: Record<string, { version: number; isDefault: boolean; invalid: boolean }> }`
  - `type SaveOutcome = { status: 'saved'; version: number } | { status: 'conflict' }`
  - `readSettings(db: Db): Promise<ResolvedSettings>`
  - `saveSection(db: Db, section: string, value: unknown, expectedVersion: number): Promise<SaveOutcome>`: `expectedVersion` 0 inserts; otherwise updates only if the stored version matches, and increments it
  - `resetSection(db: Db, section: string, expectedVersion: number): Promise<SaveOutcome>`: deletes the row if the version matches; `saved` carries `version: 0`

- [ ] **Step 1: Add the table to `db/schema.ts`**

Add `jsonb` to the `drizzle-orm/pg-core` import list, and append after `rotations`:

```ts
/**
 * One row per settings section (`src/model/settings/defaults.js`), edited on the Settings page.
 * No row means the section's default. `version` makes saves optimistic: a save names the
 * version it edited and loses to any save in between.
 */
export const settings = pgTable('settings', {
  section: text('section').primaryKey(),
  value: jsonb('value').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: timestamp('updated_at', tz).notNull().defaultNow(),
});
```

Also update the file header's second paragraph: replace "`public_holidays` and `rotations` are dashboard settings, maintained by SQL (seeded by `scripts/import-sheet.ts`)." with "`settings` holds the Settings page's sections, written only by `api/settings.ts`." (Leave `publicHolidays` and `rotations` in place; Task 4 removes them.)

- [ ] **Step 2: Generate the migration**

Run: `bun run db:generate --name=settings`
Expected: creates `db/migrations/0002_settings.sql` containing only `CREATE TABLE "settings" (...)`, plus `meta/0002_snapshot.json` and a journal entry. If drizzle-kit asks an interactive question, stop: the schema change is wrong (it should only add a table).

- [ ] **Step 3: Append the data copy to `db/migrations/0002_settings.sql`**

After the generated `CREATE TABLE` statement, append:

```sql
--> statement-breakpoint
-- Carries the two retired settings tables into the calendar section, so no holiday or
-- rotation is lost. A holiday stored without a name gets the generic label the dashboard
-- used to show for it. Writes nothing when both tables are empty, leaving the default.
INSERT INTO "settings" ("section", "value")
SELECT 'calendar', jsonb_build_object(
  'holidays', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'date', "date"::text,
      'name', COALESCE(NULLIF(btrim("name"), ''), 'Public holiday')
    ) ORDER BY "date") FROM "public_holidays"), '[]'::jsonb),
  'rotations', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', "name", 'start', "start_date"::text, 'end', "end_date"::text
    ) ORDER BY "start_date") FROM "rotations"), '[]'::jsonb)
)
WHERE EXISTS (SELECT 1 FROM "public_holidays") OR EXISTS (SELECT 1 FROM "rotations");
```

- [ ] **Step 4: Check the snapshot agrees with the schema**

Run: `bun run db:generate`
Expected: `No schema changes, nothing to migrate`.

- [ ] **Step 5: Add `settings` to the test database's table list**

In `test/support/db.ts`, add `'settings'` to the end of the `TABLES` array.

- [ ] **Step 6: Write the failing DB tests**

Create `test/lib/settings.test.ts`:

```ts
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
```

- [ ] **Step 7: Run the tests to verify they fail**

Run: `bun test test/lib/settings.test.ts`
Expected: FAIL, `Cannot find module '../../lib/settings.ts'` (or, without `TEST_DATABASE_URL`, the suite is skipped; it must then be run with `.env.test` present before this task is done).

- [ ] **Step 8: Write `lib/settings.ts`**

```ts
/**
 * The settings table: read every section, and save or reset one.
 *
 * Values are checked by the caller (`api/settings.ts` runs `validateSection` first); this file
 * only stores them. Every write is one statement, as `neon-http` requires, and names the
 * version it edited: a save from a page opened before someone else's save loses, rather than
 * silently undoing it.
 *
 * Server code receives settings as a value from `readSettings` and passes it on. It never uses
 * `src/model/settings/active.js`, because requests here run concurrently.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.ts';
import { settings } from '../db/schema.ts';
import { resolveSettings } from '../src/model/settings/resolve.js';

/** Every section's value in force, and per section its stored version and state. */
export type ResolvedSettings = {
  values: Record<string, Record<string, unknown>>;
  meta: Record<string, { version: number; isDefault: boolean; invalid: boolean }>;
};

/** What a save or reset did. */
export type SaveOutcome = { status: 'saved'; version: number } | { status: 'conflict' };

/**
 * Reads every section, defaults filled in.
 *
 * A stored section that fails validation is replaced by its default and logged by name only:
 * a setting's value can quote a personnel line, so it is never logged.
 *
 * @param db Any handle that can select from `settings` (owner or `dashboard_read`).
 * @returns The resolved settings.
 */
export async function readSettings(db: Db): Promise<ResolvedSettings> {
  const rows = await db
    .select({ section: settings.section, value: settings.value, version: settings.version })
    .from(settings);
  const resolved = resolveSettings(rows) as ResolvedSettings;
  for (const [section, meta] of Object.entries(resolved.meta)) {
    if (meta.invalid) console.error(`settings: the stored "${section}" section is invalid; using its defaults.`);
  }
  return resolved;
}

/**
 * Saves one section, if nobody has saved it since `expectedVersion`.
 *
 * @param db The owner handle.
 * @param section A known section name.
 * @param value The validated, cleaned value.
 * @param expectedVersion The version the caller edited: 0 when the section was a default.
 * @returns The new version, or a conflict.
 */
export async function saveSection(db: Db, section: string, value: unknown, expectedVersion: number): Promise<SaveOutcome> {
  const rows =
    expectedVersion === 0
      ? await db.insert(settings).values({ section, value }).onConflictDoNothing().returning({ version: settings.version })
      : await db
          .update(settings)
          .set({ value, version: sql`${settings.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(settings.section, section), eq(settings.version, expectedVersion)))
          .returning({ version: settings.version });
  const saved = rows[0];
  return saved ? { status: 'saved', version: saved.version } : { status: 'conflict' };
}

/**
 * Resets one section to its default by deleting its row, if nobody has saved it since
 * `expectedVersion`.
 *
 * @param db The owner handle.
 * @param section A known section name.
 * @param expectedVersion The version the caller saw: 0 when it was already the default.
 * @returns `saved` at version 0, or a conflict.
 */
export async function resetSection(db: Db, section: string, expectedVersion: number): Promise<SaveOutcome> {
  if (expectedVersion === 0) {
    const existing = await db.select({ version: settings.version }).from(settings).where(eq(settings.section, section));
    return existing.length === 0 ? { status: 'saved', version: 0 } : { status: 'conflict' };
  }
  const rows = await db
    .delete(settings)
    .where(and(eq(settings.section, section), eq(settings.version, expectedVersion)))
    .returning({ section: settings.section });
  return rows.length > 0 ? { status: 'saved', version: 0 } : { status: 'conflict' };
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `bun test test/lib/settings.test.ts test/support/db.test.ts`
Expected: PASS (with `TEST_DATABASE_URL` set in `.env.test`).

- [ ] **Step 10: Run the whole suite**

Run: `bun test ./test/`
Expected: PASS; no existing test changes behaviour.

- [ ] **Step 11: Commit**

```bash
git add db/schema.ts db/migrations/0002_settings.sql db/migrations/meta/0002_snapshot.json db/migrations/meta/_journal.json lib/settings.ts test/support/db.ts test/lib/settings.test.ts
git commit -m "feat(settings): settings table, calendar carried over, optimistic save and reset"
```

---

### Task 4: The dashboard reads the calendar from settings; the old tables go

**Files:**
- Modify: `db/schema.ts` (remove `publicHolidays`, `rotations`)
- Create: `db/migrations/0003_drop_old_settings_tables.sql` (+ meta, generated)
- Modify: `lib/dashboard.ts`, `src/data/tabs.js`, `api/dashboard.ts`, `src/data/feed.js`, `src/model/calendarMarks.js`, `src/pages/Settings.jsx`, `scripts/import-sheet.ts`, `db/grants-dashboard.sql`, `test/support/db.ts`, `test/support/app.ts`
- Delete: `db/seed-public-holidays.sql`
- Test: `test/api/dashboard.test.ts`, `test/lib/dashboard.test.ts`, `test/dashboard/calendarMarks.test.js`, `test/scripts/import-sheet.test.ts`, new `test/dashboard/feed-settings.test.js`

**Interfaces:**
- Consumes: `readSettings`, `ResolvedSettings` (Task 3); `defaultSettings` (Task 2); `setActiveSettings` (Task 2).
- Produces:
  - `/api/dashboard` answers `{ ok, generatedAt, tabs, settings: ResolvedSettings }` (Task 5 adds `canEdit`).
  - `api/dashboard.ts` `Deps` gains `loadSettings: () => Promise<ResolvedSettings>`.
  - `src/data/feed.js` exports `datasetFromReply(body): Object`, the pure mapping `loadAll` uses; the dataset gains `settings` (values), `settingsMeta`, and keeps `holidays` (`{date, name}[]`) and `rotations` (`{name, start_date, end_date}[]`) in the record shape the model already reads.

- [ ] **Step 1: Write the failing feed test**

Create `test/dashboard/feed-settings.test.js`:

```js
/**
 * The dashboard reply's settings, mapped into the dataset the pages read: holidays and
 * rotations keep the record shape the model has always read, now sourced from the calendar
 * section, and the settings become the active settings.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { datasetFromReply } from '../../src/data/feed.js';
import { DEFAULTS } from '../../src/model/settings/defaults.js';
import { resetActiveSettings, settingOf } from '../../src/model/settings/active.js';
import { defaultSettings } from '../../src/model/settings/resolve.js';
import { TABS, STRENGTH_HEADERS, PERSONNEL_HEADERS, ROSTER_HEADERS } from '../../src/data/tabs.js';

/**
 * A minimal reply with the required tabs empty and the given settings.
 * @param {?Object} settings The `settings` field, or null to leave it out.
 * @returns {!Object} The reply body.
 */
function reply(settings) {
  return {
    ok: true,
    generatedAt: '2026-09-24T00:00:00.000Z',
    tabs: { [TABS.STRENGTH]: [STRENGTH_HEADERS], [TABS.PERSONNEL]: [PERSONNEL_HEADERS], [TABS.ROSTER]: [ROSTER_HEADERS] },
    ...(settings ? { settings } : {}),
  };
}

describe('datasetFromReply', () => {
  afterEach(() => resetActiveSettings());

  test('holidays and rotations come from the calendar section, in the model\'s record shape', () => {
    const values = defaultSettings();
    values.calendar = {
      holidays: [{ date: '2026-08-09', name: 'National Day' }],
      rotations: [{ name: 'Rot 1', start: '2026-07-01', end: '2026-09-30' }],
    };
    const data = datasetFromReply(reply({ values, meta: {} }));
    expect(data.holidays).toEqual([{ date: '2026-08-09', name: 'National Day' }]);
    expect(data.rotations).toEqual([{ name: 'Rot 1', start_date: '2026-07-01', end_date: '2026-09-30' }]);
    expect(data.available.holidays).toBe(true);
  });

  test('an empty calendar is noted, not an error', () => {
    const data = datasetFromReply(reply({ values: defaultSettings(), meta: {} }));
    expect(data.holidays).toEqual([]);
    expect(data.available.holidays).toBe(false);
    expect(data.notes['Public Holidays']).toContain('Settings');
  });

  test('a reply without settings reads as the defaults', () => {
    const data = datasetFromReply(reply(null));
    expect(data.settings).toEqual(DEFAULTS);
  });

  test('the reply\'s settings become the active settings', () => {
    const values = defaultSettings();
    values.thresholds = { longMcDays: 21, leaderboardSize: 5 };
    datasetFromReply(reply({ values, meta: {} }));
    expect(settingOf('thresholds').leaderboardSize).toBe(5);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test test/dashboard/feed-settings.test.js`
Expected: FAIL, `datasetFromReply` is not exported.

- [ ] **Step 3: Drop the old tables from the schema and generate the migration**

In `db/schema.ts` delete the `publicHolidays` and `rotations` table definitions (and their docstrings). Remove the now-unused `check`/`uniqueIndex` imports only if nothing else uses them (`check` is used by other tables; `uniqueIndex` by `paradeSubmissions`; keep both).

Run: `bun run db:generate --name=drop_old_settings_tables`
Expected: `db/migrations/0003_drop_old_settings_tables.sql` contains exactly `DROP TABLE "public_holidays" CASCADE;` and `DROP TABLE "rotations" CASCADE;` (drizzle-kit may omit `CASCADE`; either is fine). No prompt: dropping without creating asks nothing.

Run: `bun run db:generate`
Expected: `No schema changes, nothing to migrate`.

- [ ] **Step 4: Stop reading the two tabs in `lib/dashboard.ts`**

- Remove `publicHolidays` and `rotations` from the schema import, and `HOLIDAY_HEADERS`, `ROTATION_HEADERS` from the `tabs.js` import.
- In the `TABS` cast, change the key union to `'STRENGTH' | 'PERSONNEL' | 'ROSTER' | 'FORMSG' | 'SUBMISSIONS'`.
- Delete `holidaysTab` and `rotationsTab`.
- Replace `loadTabs`'s body with:

```ts
  const [strength, personnel, roster, formSg, submissions] = await Promise.all([
    strengthTab(db),
    personnelTab(db),
    rosterTab(db),
    formSgTab(db),
    submissionsTab(db),
  ]);
  return {
    [TABS.STRENGTH]: toTab(STRENGTH_HEADERS, strength),
    [TABS.PERSONNEL]: toTab(PERSONNEL_HEADERS, personnel),
    [TABS.ROSTER]: toTab(ROSTER_HEADERS, roster),
    [TABS.FORMSG]: toTab(FORMSG_HEADERS, formSg),
    [TABS.SUBMISSIONS]: toTab(SUBMISSION_HEADERS, submissions),
  };
```

- [ ] **Step 5: Remove the two tabs from `src/data/tabs.js`**

Delete `HOLIDAYS` and `ROTATIONS` from `TABS`, delete `HOLIDAY_HEADERS` and `ROTATION_HEADERS` (with their docstrings), and delete the two `OPTIONAL_TABS` entries for them. In the `OPTIONAL_TABS` docstring, replace "or has not created the two settings tabs" with "or has not set up the calendar".

- [ ] **Step 6: Return settings from `api/dashboard.ts`**

- Import `type ResolvedSettings` and `readSettings` from `../lib/settings.ts`.
- Add to `Deps`: `/** Reads the settings in force; only called once the caller checks out. */ loadSettings: () => Promise<ResolvedSettings>;`
- In `handle`, replace the `try` body with:

```ts
    const [tabs, settings] = await Promise.all([deps.loadTabs(), deps.loadSettings()]);
    return reply(200, { ok: true, generatedAt: (deps.now ?? (() => new Date()))().toISOString(), tabs, settings });
```

- In `route`, build the handle once and pass both readers:

```ts
function route(request: Request): Promise<Response> {
  const db = () => getDb('DASHBOARD_DATABASE_URL');
  return handle(request, {
    loadTabs: () => loadTabs(db()),
    loadSettings: () => readSettings(db()),
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    hasDatabase: Boolean(process.env.DASHBOARD_DATABASE_URL),
  });
}
```

- Update the file header's first line list: `GET    all tabs and the settings in force    a dashboard session cookie, or the password as a bearer token`.

- [ ] **Step 7: Map settings into the dataset in `src/data/feed.js`**

- Remove `HOLIDAY_HEADERS`, `ROTATION_HEADERS` from the import; add `import { setActiveSettings } from '../model/settings/active.js';` and `import { defaultSettings } from '../model/settings/resolve.js';`.
- Remove the `holidays` and `rotations` entries from `OPTIONAL_TAB_SPECS`.
- Change `fetchTabs` to return the whole body: replace its last line with `return body;` and update its `@returns` to `{!Promise<!Object>} The reply body: tabs, generatedAt, settings.`
- Add, above `loadAll`:

```js
/**
 * What an empty calendar list means for the charts, keyed by the name the Settings page shows.
 * @type {!Object<string, string>}
 */
const EMPTY_CALENDAR_NOTES = {
  'Public Holidays': 'No public holidays are set, so none are marked on any chart. Add them under Settings → Calendar.',
  Rotations: 'No rotations are set, so rotational grouping is unavailable. Add them under Settings → Calendar.',
};

/**
 * Maps a dashboard reply to the dataset the pages read, and makes its settings the active ones.
 *
 * Holidays and rotations come from the calendar section but keep the record shape the model
 * has always read (`rotations` with `start_date`/`end_date`), so no model code changes.
 * @param {!Object} body The `/api/dashboard` reply.
 * @returns {!Object} Records per tab, `settings`, `settingsMeta`, `holidays`, `rotations`,
 *     `generatedAt`, `notes` and `available`.
 * @throws {Error} When a required tab's header row no longer matches.
 */
export function datasetFromReply(body) {
  const tabs = body.tabs || {};
  const settings = (body.settings && body.settings.values) || defaultSettings();
  const notes = {};
  const data = {
    generatedAt: body.generatedAt || '',
    notes,
    available: {},
    settings,
    settingsMeta: (body.settings && body.settings.meta) || {},
  };

  REQUIRED_TABS.forEach((spec) => {
    data[spec.key] = toRecords(tabs[spec.tab], spec.headers, spec.tab);
    data.available[spec.key] = true;
  });
  OPTIONAL_TAB_SPECS.forEach((spec) => {
    data[spec.key] = readOptional(tabs, spec, notes);
    data.available[spec.key] = !(spec.tab in notes);
  });

  data.holidays = settings.calendar.holidays.map((holiday) => ({ date: holiday.date, name: holiday.name }));
  data.rotations = settings.calendar.rotations.map((rotation) => ({
    name: rotation.name,
    start_date: rotation.start,
    end_date: rotation.end,
  }));
  data.available.holidays = data.holidays.length > 0;
  data.available.rotations = data.rotations.length > 0;
  if (!data.available.holidays) notes['Public Holidays'] = EMPTY_CALENDAR_NOTES['Public Holidays'];
  if (!data.available.rotations) notes.Rotations = EMPTY_CALENDAR_NOTES.Rotations;

  setActiveSettings(settings);
  return data;
}
```

- Replace `loadAll`'s body with `return fetchTabs().then(datasetFromReply);` and update its docstring's `@returns` to mention `settings`.

- [ ] **Step 8: Remove the hardcoded Singapore map from `src/model/calendarMarks.js`**

Delete `SG_PUBLIC_HOLIDAYS` and its docstring. In `toHolidays`, replace the two `return`s for a named/unnamed row with `return { date, name: toText(row.name) || 'Public holiday' };`. Update `toHolidays`'s docstring: "A blank name falls back to a generic label; the Calendar settings require a name, so this only covers a row from elsewhere." Update the module header: holidays now come from the Calendar settings, not an optional tab.

In `test/dashboard/calendarMarks.test.js`, delete the two tests "a blank name on a known Singapore holiday resolves to its official name" and "a non-blank sheet name wins over the Singapore map for the same date", and rename "a blank name on a date not in the Singapore map falls back to the generic label" to "a blank name falls back to the generic label".

- [ ] **Step 9: Point the Settings page's empty panels at the Calendar settings**

In `src/pages/Settings.jsx`, delete `EmptySettingsPanel`; delete the `TABS` import. In `Settings()`, render `HolidaysPanel` and `RotationsPanel` unconditionally (their own `EmptyState` already covers no rows). Change `HolidaysPanel`'s empty text to "No public holidays are set." and `RotationsPanel`'s to "No rotations are set. Rotational grouping is unavailable." Update the module header: settings are no longer maintained by SQL (Task 9 adds the editors).

- [ ] **Step 10: Stop importing holidays and rotations in `scripts/import-sheet.ts`**

Delete `mapHoliday`, `mapRotation`, the `holidays`/`rotationRows` lines and their two `report(...)` lines in `main`, and `publicHolidays`, `rotations` from the schema import. In the header comment, delete the sentence about holidays and rotations and add: "Holidays and rotations are not imported: they are settings now, edited under Settings → Calendar." In `test/scripts/import-sheet.test.ts`, delete the `settings tabs` describe block and remove `mapHoliday`, `mapRotation` from the import.

- [ ] **Step 11: Update grants, test support and the DB dashboard test**

- `db/grants-dashboard.sql`: in the `GRANT SELECT ON` list replace `public_holidays,\n  rotations` with `settings`; change the header's "the two settings tables" to "the settings"; change the verification line to `--   DELETE FROM settings;                               -- must FAIL: permission denied`.
- `test/support/db.ts`: remove `'public_holidays'` and `'rotations'` from `TABLES`.
- `test/support/app.ts`: import `readSettings` from `../../lib/settings.ts`; in the `/api/dashboard` branch add `loadSettings: () => readSettings(db)` to the deps.
- `test/lib/dashboard.test.ts`: remove `publicHolidays, rotations` from the import, the `HOLIDAY`/`ROTATION` constants and their two inserts; rename the test to "the submissions tab lists each parade state once" and delete its two holiday/rotation `expect`s.
- `test/api/dashboard.test.ts`: in `setup`, add `loadSettings: async () => SETTINGS,` where `const SETTINGS = { values: {}, meta: {} };` is declared beside `TABS`; update the "right password reads every tab" expectation to `{ ok: true, generatedAt: '2026-09-22T01:00:00.000Z', tabs: TABS, settings: SETTINGS }`.
- Delete `db/seed-public-holidays.sql` (`git rm db/seed-public-holidays.sql`).

- [ ] **Step 12: Run the tests**

Run: `bun test ./test/`
Expected: PASS, including `feed-settings.test.js`. Also run `bunx tsc --noEmit` if the repo's `tsconfig.json` covers `api/` and `lib/` (it does), expecting no errors.

Note: `bunx` is Bun's runner, not npm's; it's allowed.

- [ ] **Step 13: Build**

Run: `bun run build`
Expected: builds with no errors (catches a browser import of a removed export).

- [ ] **Step 14: Commit**

```bash
git add -A db/schema.ts db/migrations lib/dashboard.ts src/data/tabs.js api/dashboard.ts src/data/feed.js src/model/calendarMarks.js src/pages/Settings.jsx scripts/import-sheet.ts db/grants-dashboard.sql db/seed-public-holidays.sql test/support/db.ts test/support/app.ts test/lib/dashboard.test.ts test/api/dashboard.test.ts test/dashboard/calendarMarks.test.js test/dashboard/feed-settings.test.js test/scripts/import-sheet.test.ts
git commit -m "feat(settings): calendar read from settings; retire the holiday and rotation tables"
```

---

### Task 5: Two passwords: read-only and read-write

**Files:**
- Modify: `lib/session.ts`, `api/session.ts`, `api/dashboard.ts`, `test/support/app.ts`
- Test: `test/api/session.test.ts`, `test/api/dashboard.test.ts`, `test/lib/session.test.ts`

**Interfaces:**
- Consumes: `readSettings` (Task 3).
- Produces:
  - `lib/session.ts`: `SETTINGS_COOKIE = 'settings_session'`; `sessionCookie(token, ttlMs, name = SESSION_COOKIE)`; `clearSessionCookie(name = SESSION_COOKIE)`; `editSecret(dashboardPassword?: string, settingsPassword?: string): string | undefined` (the settings password, unless unset or equal to the dashboard password); `hasSettingsSession(request, secret: string | undefined, now: number): boolean`.
  - `api/session.ts` `Deps`: `{ dashboardPassword; settingsPassword?: string; sessionTtlMs?: () => Promise<number>; now? }`. POST answers `{ ok, expiresAt, canEdit }`. DELETE clears both cookies.
  - `api/dashboard.ts` `Deps` gains `settingsPassword?: string`; the reply gains `canEdit: boolean`.
  - `test/support/app.ts` exports `SETTINGS_PASSWORD = 'settings-test-password-long-enough'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/lib/session.test.ts` (import `editSecret`, `hasSettingsSession`, `SETTINGS_COOKIE`, `issueSession`, `SESSION_TTL_MS` as needed):

```ts
describe('editSecret', () => {
  test('is the settings password only when it is set and differs from the dashboard password', () => {
    expect(editSecret('read-pw', 'write-pw')).toBe('write-pw');
    expect(editSecret('read-pw', undefined)).toBeUndefined();
    expect(editSecret('read-pw', '')).toBeUndefined();
    expect(editSecret('same-pw', 'same-pw')).toBeUndefined();
  });
});

describe('hasSettingsSession', () => {
  test('verifies the settings cookie against the settings password only', () => {
    const now = Date.UTC(2026, 8, 24);
    const token = issueSession('write-pw', SESSION_TTL_MS, now);
    const request = new Request('https://x.test/', { headers: { cookie: `${SETTINGS_COOKIE}=${token}` } });
    expect(hasSettingsSession(request, 'write-pw', now)).toBe(true);
    expect(hasSettingsSession(request, 'read-pw', now)).toBe(false);
    expect(hasSettingsSession(request, undefined, now)).toBe(false);
  });
});
```

Append to `test/api/session.test.ts` (extend `setup` defaults with `settingsPassword: EDIT_PASSWORD` where `const EDIT_PASSWORD = 'a-long-settings-password';`, and add a helper):

```ts
/**
 * Every `Set-Cookie` a response carries.
 *
 * @param response The response.
 * @returns The header values.
 */
function cookiesOf(response: Response): string[] {
  return response.headers.getSetCookie();
}

describe('api/session, two passwords', () => {
  test('the settings password opens the dashboard and editing: two cookies, canEdit true', async () => {
    const response = await handle(login({ password: EDIT_PASSWORD }), setup());
    expect(response.status).toBe(200);
    expect((await response.json()).canEdit).toBe(true);
    const cookies = cookiesOf(response);
    expect(cookies.some((c) => c.startsWith('dashboard_session='))).toBe(true);
    expect(cookies.some((c) => c.startsWith('settings_session='))).toBe(true);
  });

  test('the dashboard password opens the dashboard only: one cookie, canEdit false', async () => {
    const response = await handle(login({ password: PASSWORD }), setup());
    expect((await response.json()).canEdit).toBe(false);
    expect(cookiesOf(response).some((c) => c.startsWith('settings_session='))).toBe(false);
  });

  test('a settings password equal to the dashboard password grants no editing', async () => {
    const response = await handle(login({ password: PASSWORD }), setup({ settingsPassword: PASSWORD }));
    expect((await response.json()).canEdit).toBe(false);
    expect(cookiesOf(response).some((c) => c.startsWith('settings_session='))).toBe(false);
  });

  test('with no dashboard password configured, even the settings password is refused', async () => {
    const response = await handle(login({ password: EDIT_PASSWORD }), setup({ dashboardPassword: undefined }));
    expect(response.status).toBe(503);
    expect(cookiesOf(response)).toEqual([]);
  });

  test('the session lasts as long as the Session settings say', async () => {
    const hour = 60 * 60 * 1000;
    const response = await handle(login({ password: PASSWORD }), setup({ sessionTtlMs: async () => hour }));
    const token = tokenOf(response);
    expect(verifySession(PASSWORD, token, NOW + hour - 1)).toBe(true);
    expect(verifySession(PASSWORD, token, NOW + hour + 1)).toBe(false);
  });

  test('when the settings cannot be read, login still works, for the default 12 hours', async () => {
    const response = await handle(
      login({ password: PASSWORD }),
      setup({ sessionTtlMs: async () => { throw new Error('database asleep'); } })
    );
    expect(response.status).toBe(200);
    expect(verifySession(PASSWORD, tokenOf(response), NOW + 12 * 60 * 60 * 1000 - 1)).toBe(true);
  });

  test('DELETE clears both cookies', async () => {
    const response = await handle(new Request(URL, { method: 'DELETE' }), setup());
    const cookies = cookiesOf(response);
    expect(cookies.filter((c) => c.includes('Max-Age=0'))).toHaveLength(2);
  });
});
```

Also change the existing test "DELETE clears the cookie…" to keep passing (it checks `toContain('Max-Age=0')` on `headers.get('set-cookie')`, which joins both, so it still passes).

Append to `test/api/dashboard.test.ts`:

```ts
describe('api/dashboard, editing', () => {
  const NOW = new Date('2026-09-22T01:00:00Z');

  test('canEdit is true only with a settings cookie signed by the settings password', async () => {
    const { deps } = setup({ settingsPassword: 'settings-pw' });
    const read = issueSession(PASSWORD, SESSION_TTL_MS, NOW.getTime());
    const edit = issueSession('settings-pw', SESSION_TTL_MS, NOW.getTime());
    const readOnly = await handle(withSession(read), deps);
    expect((await readOnly.json()).canEdit).toBe(false);
    const both = new Request(URL, { headers: { cookie: `${SESSION_COOKIE}=${read}; settings_session=${edit}` } });
    expect((await (await handle(both, deps)).json()).canEdit).toBe(true);
  });
});
```

Update the existing "right password reads every tab" expectation to include `canEdit: false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test test/lib/session.test.ts test/api/session.test.ts test/api/dashboard.test.ts`
Expected: FAIL, missing exports and `canEdit` undefined.

- [ ] **Step 3: Extend `lib/session.ts`**

Add after `SESSION_TTL_MS`:

```ts
/** The second cookie, held only by someone who logged in with `SETTINGS_PASSWORD`. */
export const SETTINGS_COOKIE = 'settings_session';
```

Change `sessionCookie` and `clearSessionCookie` to take the cookie name (defaulting to `SESSION_COOKIE`), updating their docstrings with `@param name The cookie's name; defaults to the dashboard session.`:

```ts
export function sessionCookie(token: string, ttlMs: number, name: string = SESSION_COOKIE): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${name}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function clearSessionCookie(name: string = SESSION_COOKIE): string {
  return `${name}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
```

Append:

```ts
/**
 * The secret that grants editing: `SETTINGS_PASSWORD`, unless it is unset or the same as
 * `DASHBOARD_PASSWORD`.
 *
 * Equal passwords would make the read-only password read-write without anyone meaning to, so
 * that configuration grants nobody editing (fail closed).
 *
 * @param dashboardPassword The `DASHBOARD_PASSWORD` in force.
 * @param settingsPassword The `SETTINGS_PASSWORD` in force.
 * @returns The settings password, or undefined when editing is off.
 */
export function editSecret(dashboardPassword: string | undefined, settingsPassword: string | undefined): string | undefined {
  return settingsPassword && settingsPassword !== dashboardPassword ? settingsPassword : undefined;
}

/**
 * Whether a request carries a valid editing session.
 *
 * The token is signed with `SETTINGS_PASSWORD`, so rotating it ends every edit session while
 * leaving read sessions alone.
 *
 * @param request The incoming request.
 * @param secret The result of `editSecret`, or undefined when editing is off.
 * @param now Milliseconds since the epoch.
 * @returns Whether the settings cookie verifies.
 */
export function hasSettingsSession(request: Request, secret: string | undefined, now: number): boolean {
  return verifySession(secret ?? '', readCookie(request, SETTINGS_COOKIE), now);
}
```

- [ ] **Step 4: Rewrite `api/session.ts`'s POST for two passwords**

Update the header comment: POST `{ password }` accepts either password; the settings password also sets `settings_session`; DELETE clears both. Then:

```ts
import { getDb } from '../db/index.ts';
import { json, methodNotAllowed, readJson, sameSecret } from '../lib/http.ts';
import { readSettings } from '../lib/settings.ts';
import {
  SESSION_TTL_MS,
  SETTINGS_COOKIE,
  clearSessionCookie,
  editSecret,
  issueSession,
  sessionCookie,
} from '../lib/session.ts';

/** What `handle` needs. */
export interface Deps {
  dashboardPassword: string | undefined;
  /** The read-write password; unset (or equal to the dashboard password) means no editing. */
  settingsPassword?: string | undefined;
  /** How long a session lasts, from the Session settings; the default when absent or failing. */
  sessionTtlMs?: () => Promise<number>;
  /** The clock, injected so tests hold it. */
  now?: () => number;
}

/**
 * How long a new session should last.
 *
 * A failed or nonsensical settings read must not stop anyone logging in, so it falls back to
 * the default.
 *
 * @param deps The configured reader.
 * @returns Milliseconds.
 */
async function sessionTtl(deps: Deps): Promise<number> {
  if (!deps.sessionTtlMs) return SESSION_TTL_MS;
  try {
    const ttl = await deps.sessionTtlMs();
    return Number.isFinite(ttl) && ttl > 0 ? ttl : SESSION_TTL_MS;
  } catch {
    return SESSION_TTL_MS;
  }
}
```

Replace `handle` with:

```ts
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method === 'DELETE') {
    const response = json(200, { ok: true }, NO_STORE);
    response.headers.append('Set-Cookie', clearSessionCookie());
    response.headers.append('Set-Cookie', clearSessionCookie(SETTINGS_COOKIE));
    return response;
  }
  if (request.method !== 'POST') return methodNotAllowed(['POST', 'DELETE']);
  if (!deps.dashboardPassword) {
    return json(503, { ok: false, error: 'not_configured' }, NO_STORE);
  }

  const parsed = await readJson<{ password?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const password = typeof parsed.body?.password === 'string' ? parsed.body.password : '';
  const edit = editSecret(deps.dashboardPassword, deps.settingsPassword);
  const canEdit = Boolean(password !== '' && edit && sameSecret(password, edit));
  if (password === '' || (!canEdit && !sameSecret(password, deps.dashboardPassword))) {
    return json(401, { ok: false, error: 'unauthorised' }, NO_STORE);
  }

  const now = (deps.now ?? (() => Date.now()))();
  const ttlMs = await sessionTtl(deps);
  const response = json(200, { ok: true, expiresAt: new Date(now + ttlMs).toISOString(), canEdit }, NO_STORE);
  response.headers.append('Set-Cookie', sessionCookie(issueSession(deps.dashboardPassword, ttlMs, now), ttlMs));
  if (canEdit) {
    response.headers.append('Set-Cookie', sessionCookie(issueSession(edit!, ttlMs, now), ttlMs, SETTINGS_COOKIE));
  }
  return response;
}
```

Replace `route` with:

```ts
function route(request: Request): Promise<Response> {
  const hasDatabase = Boolean(process.env.DASHBOARD_DATABASE_URL);
  return handle(request, {
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    settingsPassword: process.env.SETTINGS_PASSWORD,
    sessionTtlMs: hasDatabase
      ? async () => Number((await readSettings(getDb('DASHBOARD_DATABASE_URL'))).values.session!.ttlHours) * 60 * 60 * 1000
      : undefined,
  });
}
```

- [ ] **Step 5: Add `canEdit` to `api/dashboard.ts`**

Import `editSecret`, `hasSettingsSession` from `../lib/session.ts`. Add to `Deps`: `/** The read-write password, for telling the page whether it may edit. */ settingsPassword?: string | undefined;`. In `handle`, compute before the `try`:

```ts
  const now = (deps.now ?? (() => new Date()))();
  const canEdit = hasSettingsSession(request, editSecret(deps.dashboardPassword, deps.settingsPassword), now.getTime());
```

and reply with `{ ok: true, generatedAt: now.toISOString(), tabs, settings, canEdit }`. In `route`, add `settingsPassword: process.env.SETTINGS_PASSWORD`.

- [ ] **Step 6: Serve both passwords in the test app**

In `test/support/app.ts`, add `export const SETTINGS_PASSWORD = 'settings-test-password-long-enough';` beside `DASHBOARD_PASSWORD`, and pass `settingsPassword: SETTINGS_PASSWORD` to both the `/api/dashboard` and `/api/session` handlers.

- [ ] **Step 7: Run the tests**

Run: `bun test test/lib/session.test.ts test/api/session.test.ts test/api/dashboard.test.ts`
Expected: PASS. Then `bun test ./test/`: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/session.ts api/session.ts api/dashboard.ts test/support/app.ts test/lib/session.test.ts test/api/session.test.ts test/api/dashboard.test.ts
git commit -m "feat(settings): read-only and read-write passwords; session length from settings"
```

---

### Task 6: `/api/settings`: save and reset a section

**Files:**
- Create: `api/settings.ts`
- Modify: `test/support/app.ts` (serve `/api/settings`)
- Test: `test/api/settings.test.ts`

**Interfaces:**
- Consumes: `saveSection`, `resetSection`, `SaveOutcome` (Task 3); `editSecret`, `hasSettingsSession`, `isSameOrigin` (Task 5 / existing); `isSection` (Task 1); `validateSection` (Task 1).
- Produces:
  - `PUT /api/settings` body `{ section, value, version }` → 200 `{ ok: true, version, warnings }` | 400 `{ ok: false, error: 'bad_request', message }` | 401 `unauthorised` | 403 `cross_site` | 409 `conflict` | 422 `{ ok: false, error: 'invalid', errors, warnings }` | 503 `not_configured`
  - `DELETE /api/settings?section=<name>&version=<n>` → 200 `{ ok: true, version: 0 }` or the same refusals
  - `Deps = { store: { save(section, value, version): Promise<SaveOutcome>; reset(section, version): Promise<SaveOutcome> }; dashboardPassword?: string; settingsPassword?: string; now?: () => number }`

- [ ] **Step 1: Write the failing tests**

Create `test/api/settings.test.ts`:

```ts
/**
 * The settings write route. The refusals matter most, and every refusal must happen before
 * the store is touched: the fake store throws if it is called when it should not be.
 */
import { describe, expect, test } from 'bun:test';
import { handle, type Deps } from '../../api/settings.ts';
import { SESSION_COOKIE, SESSION_TTL_MS, SETTINGS_COOKIE, issueSession } from '../../lib/session.ts';

const READ = 'read-only-password-long';
const WRITE = 'read-write-password-long';
const URL = 'https://example.vercel.app/api/settings';
const NOW = Date.UTC(2026, 8, 24, 2, 0, 0);
const UNIT = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };

/**
 * Deps over a store that records calls, or throws when `untouchable`.
 *
 * @param overrides Fields to replace.
 * @param untouchable Whether any store call should fail the test.
 * @returns The deps and the recorded calls.
 */
function setup(overrides: Partial<Deps> = {}, untouchable = false) {
  const calls: unknown[][] = [];
  const touch = (name: string, ...args: unknown[]) => {
    if (untouchable) throw new Error(`store.${name} must not be called`);
    calls.push([name, ...args]);
  };
  const deps: Deps = {
    store: {
      save: async (...args) => (touch('save', ...args), { status: 'saved', version: 4 }),
      reset: async (...args) => (touch('reset', ...args), { status: 'saved', version: 0 }),
    },
    dashboardPassword: READ,
    settingsPassword: WRITE,
    now: () => NOW,
    ...overrides,
  };
  return { deps, calls };
}

/**
 * A request from the dashboard's own page, carrying the given cookies.
 *
 * @param method The HTTP method.
 * @param options The query string, JSON body, cookies, and fetch-site header.
 * @returns The request.
 */
function request(
  method: string,
  options: { query?: string; body?: unknown; edit?: boolean; read?: boolean; site?: string } = {},
): Request {
  const cookies = [];
  if (options.read !== false) cookies.push(`${SESSION_COOKIE}=${issueSession(READ, SESSION_TTL_MS, NOW)}`);
  if (options.edit !== false) cookies.push(`${SETTINGS_COOKIE}=${issueSession(WRITE, SESSION_TTL_MS, NOW)}`);
  return new Request(URL + (options.query ?? ''), {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Sec-Fetch-Site': options.site ?? 'same-origin',
      cookie: cookies.join('; '),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe('api/settings refusals, all before the store', () => {
  test('a read-only session cannot save', async () => {
    const { deps } = setup({}, true);
    const response = await handle(request('PUT', { edit: false, body: { section: 'unit', value: UNIT, version: 0 } }), deps);
    expect(response.status).toBe(401);
  });

  test('a cross-site request is refused even with both cookies', async () => {
    const { deps } = setup({}, true);
    const response = await handle(request('PUT', { site: 'cross-site', body: { section: 'unit', value: UNIT, version: 0 } }), deps);
    expect(response.status).toBe(403);
  });

  test('no settings password, or one equal to the dashboard password, means no editing at all', async () => {
    for (const settingsPassword of [undefined, READ]) {
      const { deps } = setup({ settingsPassword }, true);
      const response = await handle(request('PUT', { body: { section: 'unit', value: UNIT, version: 0 } }), deps);
      expect(response.status).toBe(503);
    }
  });

  test('an unknown section, a bad version, or a malformed body is a 400', async () => {
    const { deps } = setup({}, true);
    for (const body of [
      { section: 'nope', value: {}, version: 0 },
      { section: 'unit', value: UNIT, version: -1 },
      { section: 'unit', value: UNIT, version: 1.5 },
      { section: 'unit', value: UNIT },
    ]) {
      expect((await handle(request('PUT', { body }), deps)).status).toBe(400);
    }
  });

  test('an invalid value is a 422 carrying field errors', async () => {
    const { deps } = setup({}, true);
    const response = await handle(request('PUT', { body: { section: 'unit', value: { ...UNIT, name: '' }, version: 0 } }), deps);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.errors.map((e: { path: string }) => e.path)).toContain('name');
  });

  test('a method it does not implement is a 405', async () => {
    const { deps } = setup({}, true);
    expect((await handle(request('GET'), deps)).status).toBe(405);
  });
});

describe('api/settings writes', () => {
  test('a valid save stores the cleaned value and answers the new version', async () => {
    const { deps, calls } = setup();
    const response = await handle(request('PUT', { body: { section: 'unit', value: { ...UNIT, name: ' 41 SAR ' }, version: 3 } }), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, version: 4, warnings: [] });
    expect(calls).toEqual([['save', 'unit', UNIT, 3]]);
  });

  test('a stale version is a 409', async () => {
    const { deps } = setup({ store: { save: async () => ({ status: 'conflict' }), reset: async () => ({ status: 'conflict' }) } });
    const response = await handle(request('PUT', { body: { section: 'unit', value: UNIT, version: 1 } }), deps);
    expect(response.status).toBe(409);
  });

  test('DELETE resets a section to its default', async () => {
    const { deps, calls } = setup();
    const response = await handle(request('DELETE', { query: '?section=unit&version=2' }), deps);
    expect(response.status).toBe(200);
    expect(calls).toEqual([['reset', 'unit', 2]]);
  });

  test('DELETE without a known section or a version is a 400', async () => {
    const { deps } = setup({}, true);
    expect((await handle(request('DELETE', { query: '?section=unit' }), deps)).status).toBe(400);
    expect((await handle(request('DELETE', { query: '?section=nope&version=1' }), deps)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/api/settings.test.ts`
Expected: FAIL, `Cannot find module '../../api/settings.ts'`.

- [ ] **Step 3: Write `api/settings.ts`**

```ts
/**
 * The Settings page's write route.
 *
 *   PUT    { section, value, version }     save one section
 *   DELETE ?section=<name>&version=<n>     reset one section to its default
 *
 * Only someone who logged in with `SETTINGS_PASSWORD` holds the `settings_session` cookie
 * this checks; the dashboard password alone reads settings (through `/api/dashboard`) but
 * cannot change them. Like the parade intake, a cookie-authorised write must also come from
 * this deployment's own pages.
 *
 * The value is validated with the same code the page ran (`src/model/settings/validate.js`),
 * so a hand-crafted request cannot store what the form would refuse. `version` is the one the
 * page edited: a save from a page opened before someone else's save answers 409 rather than
 * undoing it.
 *
 * Every refusal happens before the store is touched. Nothing here logs a value.
 */
import { getDb } from '../db/index.ts';
import { json, methodNotAllowed, readJson, serverError } from '../lib/http.ts';
import { editSecret, hasSettingsSession, isSameOrigin } from '../lib/session.ts';
import { resetSection, saveSection, type SaveOutcome } from '../lib/settings.ts';
import { isSection } from '../src/model/settings/defaults.js';
import { validateSection } from '../src/model/settings/validate.js';

/** The settings writes, injected so tests need no database. */
export interface SettingsStore {
  save(section: string, value: unknown, version: number): Promise<SaveOutcome>;
  reset(section: string, version: number): Promise<SaveOutcome>;
}

/** What `handle` needs. */
export interface Deps {
  store: SettingsStore;
  dashboardPassword: string | undefined;
  settingsPassword: string | undefined;
  /** The clock, injected so tests hold it. */
  now?: () => number;
}

/** No response here may be cached. */
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Builds a JSON response that is never cached.
 *
 * @param status The HTTP status code.
 * @param body Anything JSON-serialisable.
 * @returns The response.
 */
function reply(status: number, body: unknown): Response {
  return json(status, body, NO_STORE);
}

/**
 * Whether a value is a version a caller could have seen: a whole number, 0 or more.
 *
 * @param value The candidate.
 * @returns True when usable.
 */
function isVersion(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

/**
 * Answers a save or reset outcome.
 *
 * @param outcome What the store did.
 * @param warnings Validation warnings to pass back.
 * @returns The response.
 */
function outcomeResponse(outcome: SaveOutcome, warnings: unknown[] = []): Response {
  if (outcome.status === 'conflict') return reply(409, { ok: false, error: 'conflict' });
  return reply(200, { ok: true, version: outcome.version, warnings });
}

/**
 * Handles PUT: validate, then save.
 *
 * @param request The incoming request.
 * @param deps The store.
 * @returns The response.
 */
async function put(request: Request, deps: Deps): Promise<Response> {
  const parsed = await readJson<{ section?: unknown; value?: unknown; version?: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const { section, value, version } = parsed.body ?? {};
  if (typeof section !== 'string' || !isSection(section)) {
    return reply(400, { ok: false, error: 'bad_request', message: 'Unknown settings section.' });
  }
  if (!isVersion(version)) {
    return reply(400, { ok: false, error: 'bad_request', message: 'version must be a whole number, 0 or more.' });
  }
  const checked = validateSection(section, value);
  if (checked.errors.length > 0) {
    return reply(422, { ok: false, error: 'invalid', errors: checked.errors, warnings: checked.warnings });
  }
  return outcomeResponse(await deps.store.save(section, checked.value, version), checked.warnings);
}

/**
 * Handles DELETE: reset one section to its default.
 *
 * @param request The incoming request.
 * @param deps The store.
 * @returns The response.
 */
async function remove(request: Request, deps: Deps): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const section = params.get('section') ?? '';
  const version = params.get('version');
  const parsedVersion = version !== null && /^\d+$/.test(version) ? Number(version) : NaN;
  if (!isSection(section) || !isVersion(parsedVersion)) {
    return reply(400, { ok: false, error: 'bad_request', message: 'section and version are required.' });
  }
  return outcomeResponse(await deps.store.reset(section, parsedVersion));
}

/**
 * Routes one request.
 *
 * Fails closed: with no dashboard password, or no distinct settings password, nobody may edit.
 *
 * @param request The incoming request.
 * @param deps The store and the configured passwords.
 * @returns The response.
 */
export async function handle(request: Request, deps: Deps): Promise<Response> {
  if (request.method !== 'PUT' && request.method !== 'DELETE') return methodNotAllowed(['PUT', 'DELETE']);
  const secret = editSecret(deps.dashboardPassword, deps.settingsPassword);
  if (!deps.dashboardPassword || !secret) return reply(503, { ok: false, error: 'not_configured' });
  const now = (deps.now ?? (() => Date.now()))();
  if (!hasSettingsSession(request, secret, now)) return reply(401, { ok: false, error: 'unauthorised' });
  if (!isSameOrigin(request)) return reply(403, { ok: false, error: 'cross_site' });
  try {
    return request.method === 'PUT' ? await put(request, deps) : await remove(request, deps);
  } catch (error) {
    return serverError(error, 'api/settings');
  }
}

/**
 * The Vercel entry point.
 *
 * Exported per HTTP method, not as `default`: Vercel runs a default-exported function as a
 * Node `(req, res)` handler, which never sends the returned `Response`, so the request hangs.
 *
 * @param request The incoming request.
 * @returns The response.
 */
function route(request: Request): Promise<Response> {
  return handle(request, {
    store: {
      save: (section, value, version) => saveSection(getDb(), section, value, version),
      reset: (section, version) => resetSection(getDb(), section, version),
    },
    dashboardPassword: process.env.DASHBOARD_PASSWORD,
    settingsPassword: process.env.SETTINGS_PASSWORD,
  });
}

export { route as DELETE, route as PUT };
```

- [ ] **Step 4: Serve it in the test app**

In `test/support/app.ts`: import `handle as handleSettings` from `../../api/settings.ts` and `resetSection, saveSection` from `../../lib/settings.ts`; add a branch before the 404:

```ts
      if (path === '/api/settings') {
        return handleSettings(request, {
          store: {
            save: (section, value, version) => saveSection(db, section, value, version),
            reset: (section, version) => resetSection(db, section, version),
          },
          dashboardPassword: DASHBOARD_PASSWORD,
          settingsPassword: SETTINGS_PASSWORD,
        });
      }
```

Update that file's header ("The app's three routes") to "The app's routes".

- [ ] **Step 5: Run the tests**

Run: `bun test test/api/settings.test.ts`, then `bun test ./test/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/settings.ts test/api/settings.test.ts test/support/app.ts
git commit -m "feat(settings): /api/settings saves and resets a section behind the read-write password"
```

---

### Task 7: Browser data layer: save, reset, unlock, refresh interval

**Files:**
- Create: `src/data/settings.js`
- Modify: `src/data/session.js`, `src/data/feed.js`, `src/app/state.js`, `src/app/auth.js`
- Test: `test/dashboard/settings-client.test.js`

**Interfaces:**
- Consumes: `settingOf` (Task 2); `/api/settings` (Task 6); `canEdit` in the dashboard reply (Task 5).
- Produces:
  - `src/data/settings.js`: `saveSection(section, value, version): Promise<{version: number, warnings: Array}>`; `resetSection(section, version): Promise<void>`; `unitSettings(): {name, pageTitle, logo}`; `refreshMs(): number`. Errors thrown carry `.status`, and on 422 `.errors` (field errors).
  - `src/data/session.js`: `startSession(password): Promise<{canEdit: boolean}>`; `unlockEditing(password): Promise<void>` (throws when the password is not the settings password).
  - `src/data/feed.js`: the dataset gains `canEdit: boolean`.
  - `src/app/state.js`: `canEdit` computed signal.
  - `src/app/auth.js`: `startAutoRefresh` re-reads at `refreshMs()`.

- [ ] **Step 1: Write the failing tests**

Create `test/dashboard/settings-client.test.js`:

```js
/**
 * The browser's settings calls: what reaches the server, and the sentence a refusal becomes.
 * `fetch` is replaced for each test; nothing leaves the process.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { refreshMs, resetSection, saveSection, unitSettings } from '../../src/data/settings.js';
import { resetActiveSettings, setActiveSettings } from '../../src/model/settings/active.js';
import { defaultSettings } from '../../src/model/settings/resolve.js';

const realFetch = globalThis.fetch;

/**
 * Replaces fetch with one that records the call and answers with the given status and body.
 * @param {number} status HTTP status.
 * @param {!Object} body JSON body.
 * @returns {!Array<!Object>} The recorded calls.
 */
function answer(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  resetActiveSettings();
});

describe('saveSection', () => {
  test('PUTs the section, value and version, and returns the new version', async () => {
    const calls = answer(200, { ok: true, version: 2, warnings: [] });
    expect(await saveSection('unit', { name: 'x' }, 1)).toEqual({ version: 2, warnings: [] });
    expect(calls[0].url).toBe('/api/settings');
    expect(calls[0].init.method).toBe('PUT');
    expect(JSON.parse(calls[0].init.body)).toEqual({ section: 'unit', value: { name: 'x' }, version: 1 });
  });

  test('a 422 carries the field errors; a 409 says someone else saved', async () => {
    answer(422, { ok: false, error: 'invalid', errors: [{ path: 'name', message: 'Enter a name.' }] });
    const invalid = await saveSection('unit', {}, 0).catch((error) => error);
    expect(invalid.status).toBe(422);
    expect(invalid.errors).toEqual([{ path: 'name', message: 'Enter a name.' }]);

    answer(409, { ok: false, error: 'conflict' });
    const conflict = await saveSection('unit', {}, 0).catch((error) => error);
    expect(conflict.message).toContain('Someone else saved');
  });
});

describe('resetSection', () => {
  test('DELETEs with the section and version in the query', async () => {
    const calls = answer(200, { ok: true, version: 0 });
    await resetSection('calendar', 3);
    expect(calls[0].url).toBe('/api/settings?section=calendar&version=3');
    expect(calls[0].init.method).toBe('DELETE');
  });
});

describe('settings the app shell reads', () => {
  test('unitSettings and refreshMs follow the active settings', () => {
    expect(unitSettings().name).toBe('40 SAR');
    expect(refreshMs()).toBe(60000);
    const values = defaultSettings();
    values.unit = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };
    values.session = { ttlHours: 12, refreshSeconds: 120 };
    setActiveSettings(values);
    expect(unitSettings().name).toBe('41 SAR');
    expect(refreshMs()).toBe(120000);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/dashboard/settings-client.test.js`
Expected: FAIL, `Cannot find module '../../src/data/settings.js'`.

- [ ] **Step 3: Write `src/data/settings.js`**

```js
/**
 * The Settings page's writes, through `/api/settings`, and the settings the app shell reads.
 *
 * Writes carry only the session cookies; whether the caller may edit is decided on the server
 * (`api/settings.ts`), where it cannot be skipped. After a successful write the caller
 * refreshes the dashboard, which is how every page picks up the new settings.
 *
 * `unitSettings` and `refreshMs` exist so `app/`, which may import only `data/` and `theme/`,
 * can read settings without reaching into `model/`.
 */

import { settingOf } from '../model/settings/active.js';

/** @type {string} The write route, served by the same Vercel deployment as this page. */
const API = '/api/settings';

/**
 * What each refusal means to the person at the form.
 * @type {!Object<number, string>}
 */
const HTTP_ERRORS = {
  400: 'The dashboard sent a request the server could not read. Reload and try again.',
  401: 'Editing has ended. Unlock editing again.',
  403: 'Settings can only be changed from the dashboard itself.',
  409: 'Someone else saved this section. Reload to see their version.',
  422: 'Some fields need fixing.',
  503: 'Editing is not configured. Set SETTINGS_PASSWORD on Vercel, different from DASHBOARD_PASSWORD.',
};

/**
 * Sends one write and turns a refusal into a readable error.
 * @param {string} url The route, with any query string.
 * @param {!RequestInit} init The request.
 * @returns {!Promise<!Object>} The reply body.
 * @throws {Error} With `status`, and `errors` on a 422.
 */
async function send_(url, init) {
  let response;
  try {
    response = await fetch(url, { ...init, credentials: 'same-origin' });
  } catch {
    throw new Error('Could not reach the dashboard. Check the network connection and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    const error = new Error(HTTP_ERRORS[response.status] || 'The settings could not be saved (HTTP ' + response.status + ').');
    error.status = response.status;
    error.errors = body.errors || [];
    throw error;
  }
  return body;
}

/**
 * Saves one section.
 * @param {string} section The section name.
 * @param {!Object} value The edited value.
 * @param {number} version The version the form was opened on (0 for a default).
 * @returns {!Promise<{version: number, warnings: !Array<!Object>}>} The new version and any
 *     warnings.
 */
export async function saveSection(section, value, version) {
  const body = await send_(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ section, value, version }),
  });
  return { version: body.version, warnings: body.warnings || [] };
}

/**
 * Resets one section to its default.
 * @param {string} section The section name.
 * @param {number} version The version shown on the page.
 * @returns {!Promise<void>} Resolves once reset.
 */
export async function resetSection(section, version) {
  await send_(API + '?section=' + encodeURIComponent(section) + '&version=' + version, { method: 'DELETE' });
}

/**
 * The unit section in force, for the logo, wordmark and page title.
 * @returns {{name: string, pageTitle: string, logo: string}} The unit settings.
 */
export function unitSettings() {
  return settingOf('unit');
}

/**
 * How often an open dashboard re-reads, from the Session settings.
 * @returns {number} Milliseconds.
 */
export function refreshMs() {
  return settingOf('session').refreshSeconds * 1000;
}
```

- [ ] **Step 4: Return `canEdit` from `startSession`, and add `unlockEditing`, in `src/data/session.js`**

Change `startSession` to parse the body on success and return `{ canEdit: body.canEdit === true }` (update `@returns` to `{!Promise<{canEdit: boolean}>}`):

```js
  const body = await response.json().catch(() => ({}));
  return { canEdit: body.canEdit === true };
```

(placed after the `if (!response.ok) { ... }` block). Append:

```js
/**
 * Unlocks editing for a viewer already reading the dashboard, with the settings password.
 *
 * It is the same login call: the settings password also opens the dashboard, so the read
 * session is simply reissued alongside the edit session.
 * @param {string} password The settings password the viewer typed.
 * @returns {!Promise<void>} Resolves once editing is unlocked.
 * @throws {Error} When the password is wrong, or is the read-only password.
 */
export async function unlockEditing(password) {
  const { canEdit } = await startSession(password);
  if (!canEdit) {
    throw new Error('That password opens the dashboard but not editing. Enter the settings password.');
  }
}
```

- [ ] **Step 5: Carry `canEdit` in the dataset and state**

- `src/data/feed.js`, in `datasetFromReply`, add `canEdit: body.canEdit === true,` to the `data` object literal.
- `src/app/state.js`, append:

```js
/**
 * Whether this session may change settings: it logged in, or unlocked editing, with the
 * settings password. The server decides; this only mirrors its answer.
 * @type {!import('@preact/signals').ReadonlySignal<boolean>}
 */
export const canEdit = computed(() => Boolean(dataset.value && dataset.value.canEdit));
```

- [ ] **Step 6: Pace the background refresh by the Session settings in `src/app/auth.js`**

Import `refreshMs` from `../data/settings.js`; delete `REFRESH_MS`. Replace the `setInterval` in `startAutoRefresh` with a self-rescheduling timeout, so a changed interval takes effect on the next tick:

```js
export function startAutoRefresh() {
  let timer = 0;
  /**
   * Refreshes if the tab is visible, then waits the current interval again.
   * @returns {void}
   */
  function tick() {
    if (document.visibilityState === 'visible') {
      refresh();
    }
    timer = window.setTimeout(tick, refreshMs());
  }
  timer = window.setTimeout(tick, refreshMs());
  /**
   * Refreshes when the tab comes back into view.
   * @returns {void}
   */
  function onVisible() {
    if (document.visibilityState === 'visible') {
      refresh();
    }
  }
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
```

Update the docstring: "re-reads at the Session settings' interval (every minute by default)". Update the header sentence "The session lasts twelve hours" to "The session lasts as long as the Session settings say (twelve hours by default)".

- [ ] **Step 7: Run the tests and build**

Run: `bun test ./test/` then `bun run build`
Expected: PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/data/settings.js src/data/session.js src/data/feed.js src/app/state.js src/app/auth.js test/dashboard/settings-client.test.js
git commit -m "feat(settings): browser save/reset/unlock calls; refresh interval from settings"
```

---

### Task 8: Unit name, logo, page title and thresholds come from settings

**Files:**
- Modify: `src/app/Logo.jsx`, `src/app/Sidebar.jsx`, `src/app/Shell.jsx`, `src/model/orbat.js`, `src/pages/Orbat.jsx`, `src/pages/Deposit.jsx`, `src/pages/shared/category.jsx`, `src/model/leaderboards.js`, `src/model/formsg.js`
- Test: `test/dashboard/settings-wiring.test.js`

**Interfaces:**
- Consumes: `settingOf` (Task 2); `unitSettings` (Task 7); `dataset` signal (existing).
- Produces: no new exports. `topByCount`, `topByDays`, `topByStatusCount` and the FormSG leaderboard default their `limit` to `thresholds.leaderboardSize`; `orbatTree`'s battalion root is named `unit.name`.

- [ ] **Step 1: Write the failing tests**

Create `test/dashboard/settings-wiring.test.js`:

```js
/**
 * Model code that reads the active settings: a changed setting changes the answer, and the
 * defaults reproduce the old hardcoded behaviour.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { topByCount } from '../../src/model/leaderboards.js';
import { orbatTree } from '../../src/model/orbat.js';
import { resetActiveSettings, setActiveSettings } from '../../src/model/settings/active.js';
import { defaultSettings } from '../../src/model/settings/resolve.js';

/**
 * Makes `count` single-day Att C episodes, one soldier each.
 * @param {number} count How many.
 * @returns {!Array<!Object>} Episodes in the shape `buildEpisodes` returns.
 */
function episodes(count) {
  return Array.from({ length: count }, (_, i) => ({
    key: 'S' + i,
    name: 'SOLDIER ' + i,
    rank: 'PTE',
    company: 'Archer',
    platoon: '1',
    dutyClass: 'Att C',
    startDate: '2026-09-01',
    endDate: '2026-09-01',
    reasons: [],
  }));
}

afterEach(() => resetActiveSettings());

describe('leaderboard size', () => {
  test('defaults to 10, and follows the Thresholds setting', () => {
    expect(topByCount(episodes(15), 'Att C')).toHaveLength(10);
    const values = defaultSettings();
    values.thresholds = { longMcDays: 14, leaderboardSize: 3 };
    setActiveSettings(values);
    expect(topByCount(episodes(15), 'Att C')).toHaveLength(3);
  });

  test('an explicit limit still wins', () => {
    expect(topByCount(episodes(15), 'Att C', 5)).toHaveLength(5);
  });
});

describe('unit name', () => {
  test('names the battalion root of the duty tree', () => {
    expect(orbatTree([], '2026-09-01').name).toBe('40 SAR');
    const values = defaultSettings();
    values.unit = { name: '41 SAR', pageTitle: '41 SAR Personnel', logo: '' };
    setActiveSettings(values);
    expect(orbatTree([], '2026-09-01').name).toBe('41 SAR');
  });
});
```

Before running, open `test/dashboard/leaderboards.test.js` and confirm the episode fields `topByCount` reads; adjust the `episodes()` helper's field names to match if they differ.

- [ ] **Step 2: Run them to verify they fail**

Run: `bun test test/dashboard/settings-wiring.test.js`
Expected: FAIL: the size stays 10 and the root stays "40 SAR" after `setActiveSettings`.

- [ ] **Step 3: Read settings in the model**

- `src/model/leaderboards.js`: `import { settingOf } from './settings/active.js';` and replace each `limit || 10` with `limit || settingOf('thresholds').leaderboardSize`. Update each `@param {number=} limit` to "defaults to the Thresholds leaderboard size (10)".
- `src/model/formsg.js`: the same for its `limit || 10`.
- `src/model/orbat.js`: `import { settingOf } from './settings/active.js';` and replace `name: '40 SAR',` with `name: settingOf('unit').name,`.

- [ ] **Step 4: Read settings in the pages**

- `src/pages/shared/category.jsx`: `import { settingOf } from '../../model/settings/active.js';`. Delete `LONG_MC_MIN_DAYS`. In `LEADERBOARDS`, drop the explicit `10` from the three `top` lambdas (they now default to the setting). In `LongMcCard`, start with `const longMcDays = settingOf('thresholds').longMcDays;`, pass `longMcDays - 1` as `minDays` to `longMcTrend` and `longMcRoster` (both count episodes *longer than* `minDays`), title the card `'Long-Term MC (≥' + longMcDays + ' days)'`, and make the empty state read `No MC in range lasts {longMcDays} days or longer.` Update the `LongMcCard` docstring ("exceeding 13 days" → "of at least the Thresholds long-MC length").
- `src/pages/Orbat.jsx`: `import { settingOf } from '../model/settings/active.js';` and replace `'40 SAR'` in the card title with `settingOf('unit').name`.
- `src/pages/Deposit.jsx`: `import { settingOf } from '../model/settings/active.js';` and build the placeholder as `settingOf('unit').name.toUpperCase() + ' ARCHER COMPANY\nFIRST PARADE STATE\nDATE: DDMMYY TIME: HHMM\n…'`.

- [ ] **Step 5: Read settings in the app shell**

- `src/app/Logo.jsx`: import `dataset` from `./state.js` and `unitSettings` from `../data/settings.js`. Change the component to read the unit on each render (reading `dataset.value` subscribes it to refreshes):

```jsx
export function Logo({ size = 28, title }) {
  // Read so the mark re-renders when a refresh brings new settings.
  void dataset.value;
  const unit = unitSettings();
  return <img class="logo-mark" src={unit.logo || logoUrl} height={size} alt={title || unit.name} />;
}
```

Update its docstring: the bundled crest is the default; the Unit settings may replace it; `title` defaults to the unit name. Before login no settings are loaded, so the login screen shows the bundled crest.
- `src/app/Sidebar.jsx`: import `unitSettings` from `../data/settings.js` and replace the literal `40 SAR` in `sidebar__wordmark` with `{unitSettings().name}` (the component already re-renders on `dataset` via its parent).
- `src/app/Shell.jsx`: import `unitSettings` from `../data/settings.js` and `dataset` from `./state.js` (if not already), replace the fallback `'40 SAR'` with `unitSettings().name`, and keep the tab title in step:

```jsx
  const pageTitle = dataset.value ? unitSettings().pageTitle : '';
  useEffect(() => {
    if (pageTitle) document.title = pageTitle;
  }, [pageTitle]);
```

(`useEffect` from `preact/hooks`; add it to the existing hooks import.)

- [ ] **Step 6: Run the tests and build**

Run: `bun test ./test/` then `bun run build`
Expected: PASS; build succeeds. `test/dashboard/orbat.test.js` and `leaderboards.test.js` still pass unchanged (defaults reproduce the old values).

- [ ] **Step 7: Commit**

```bash
git add src/app/Logo.jsx src/app/Sidebar.jsx src/app/Shell.jsx src/model/orbat.js src/pages/Orbat.jsx src/pages/Deposit.jsx src/pages/shared/category.jsx src/model/leaderboards.js src/model/formsg.js test/dashboard/settings-wiring.test.js
git commit -m "feat(settings): unit name, logo, title and thresholds read from settings"
```

---

### Task 9: The Settings page: Basic and Advanced tabs, section editors, unlock

**Files:**
- Modify: `src/pages/Settings.jsx`, `src/theme/components.css`
- Create: `src/pages/settings/SectionCard.jsx`, `src/pages/settings/editors.jsx`, `src/pages/settings/UnlockPanel.jsx`

**Interfaces:**
- Consumes: `SECTIONS` (Task 1), `validateSection`, `errorAt` (Task 1), `saveSection`, `resetSection` (Task 7), `unlockEditing` (Task 7), `refresh` (`src/app/auth.js`), `canEdit`, `dataset` (`src/app/state.js`), `Card`, `Banner`, `EmptyState` (`src/components/Card.jsx`), `Segmented` (`src/components/Segmented.jsx`), `DataTable` (`src/components/Table.jsx`), `fmtDate`, `fmtInt` (`src/format.js`), `weekdayOf` (`src/model/dates.js`).
- Produces: UI only. `SectionCard({ section, title, value, meta, View, Editor })`; editors take `{ draft, setDraft, errors }`.

Pages are not under test in this repo (`model/` is); this task is verified by build and by hand.

- [ ] **Step 1: Write `src/pages/settings/SectionCard.jsx`**

```jsx
/**
 * One settings section as a card: what it is set to, and, for an editor, a form to change it.
 *
 * The form checks the draft with the same validator the server runs, so a mistake is shown
 * beside its field before anything is sent. A save names the version the form opened on;
 * if someone else saved in between, the server refuses and the card says so rather than
 * overwriting their change. After a save or reset the dashboard re-reads, which is how every
 * page picks up the new value.
 */

import { useState } from 'preact/hooks';
import { refresh } from '../../app/auth.js';
import { canEdit } from '../../app/state.js';
import { Banner, Card } from '../../components/Card.jsx';
import { resetSection, saveSection } from '../../data/settings.js';
import { validateSection } from '../../model/settings/validate.js';

/**
 * A section card.
 * @param {{section: string, title: string, value: !Object, meta: ?Object,
 *     View: function(!Object): !preact.VNode, Editor: function(!Object): !preact.VNode}} props
 *     The section, its card title, its value in force, its stored version/state, and the
 *     components that show and edit it.
 * @returns {!preact.VNode} The card.
 */
export function SectionCard({ section, title, value, meta, View, Editor }) {
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const version = (meta && meta.version) || 0;
  const note = meta && meta.invalid ? 'Stored value invalid, showing defaults' : meta && meta.isDefault ? 'Default' : '';

  /**
   * Opens the form on a copy of the value in force.
   * @returns {void}
   */
  function edit() {
    setDraft(structuredClone(value));
    setErrors([]);
    setWarnings([]);
    setMessage('');
  }

  /**
   * Runs a write, then re-reads the dashboard; shows a refusal on the card.
   * @param {function(): !Promise<*>} write The save or reset.
   * @returns {!Promise<void>} Resolves when done.
   */
  async function run(write) {
    setBusy(true);
    setMessage('');
    try {
      const result = await write();
      setWarnings((result && result.warnings) || []);
      setDraft(null);
      await refresh();
    } catch (error) {
      setErrors(error.errors || []);
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Validates the draft locally, then saves it.
   * @param {!Event} event The submit event.
   * @returns {void}
   */
  function onSave(event) {
    event.preventDefault();
    const checked = validateSection(section, draft);
    setErrors(checked.errors);
    setWarnings(checked.warnings);
    if (checked.errors.length > 0) {
      setMessage('Some fields need fixing.');
      return;
    }
    run(() => saveSection(section, checked.value, version));
  }

  return (
    <Card title={title} note={note}>
      {meta && meta.invalid ? (
        <Banner tone="error">
          The stored {title} settings could not be read, so the defaults are in use. Save this section to replace them.
        </Banner>
      ) : null}
      {draft === null ? (
        <View value={value} />
      ) : (
        <form class="settings-form" onSubmit={onSave}>
          <Editor draft={draft} setDraft={setDraft} errors={errors} />
          <div class="settings-form__actions">
            <button class="button button--primary" type="submit" disabled={busy}>
              {busy ? 'Saving' : 'Save'}
            </button>
            <button class="button button--quiet" type="button" disabled={busy} onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {message ? <Banner tone="error">{message}</Banner> : null}
      {warnings.map((warning, index) => (
        <Banner tone="warning" key={index}>
          {warning.message}
        </Banner>
      ))}
      {canEdit.value && draft === null ? (
        <div class="settings-form__actions">
          <button class="button" type="button" disabled={busy} onClick={edit}>
            Edit
          </button>
          {meta && !meta.isDefault ? (
            <button class="button button--quiet" type="button" disabled={busy} onClick={() => run(() => resetSection(section, version))}>
              Reset to defaults
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
```

- [ ] **Step 2: Write `src/pages/settings/editors.jsx`**

```jsx
/**
 * The view and the form for each Phase 1 section.
 *
 * Every editor takes `{ draft, setDraft, errors }`: the value being edited, a setter taking the
 * next whole value, and the field errors to show beside each input. Numbers are read from
 * inputs as numbers, so the validator sees what the server will.
 */

import { Banner, EmptyState } from '../../components/Card.jsx';
import { DataTable } from '../../components/Table.jsx';
import { fmtDate } from '../../format.js';
import { weekdayOf } from '../../model/dates.js';
import { MAX_LOGO_CHARS, errorAt } from '../../model/settings/validate.js';

/**
 * A labelled input with its error beneath.
 * @param {{label: string, error: string, children: *}} props The label, the field's error,
 *     and the input.
 * @returns {!preact.VNode} The field.
 */
function Field({ label, error, children }) {
  return (
    <label class="settings-field">
      <span class="field__label">{label}</span>
      {children}
      {error ? <span class="settings-field__error">{error}</span> : null}
    </label>
  );
}

/**
 * Reads a number input: a whole number, or the raw text so the validator can refuse it.
 * @param {!Event} event The input event.
 * @returns {number|string} The number, or the text when it is not one.
 */
function numberFrom(event) {
  const text = event.currentTarget.value;
  return text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
}

/**
 * Replaces one item of a list field.
 * @param {!Array<!Object>} list The list.
 * @param {number} index The item.
 * @param {!Object} patch Fields to replace.
 * @returns {!Array<!Object>} A new list.
 */
function patchAt(list, index, patch) {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/**
 * Shows the unit settings.
 * @param {{value: !Object}} props The unit section.
 * @returns {!preact.VNode} The view.
 */
export function UnitView({ value }) {
  return (
    <dl class="settings-list">
      <dt>Unit name</dt>
      <dd>{value.name}</dd>
      <dt>Page title</dt>
      <dd>{value.pageTitle}</dd>
      <dt>Logo</dt>
      <dd>{value.logo ? <img class="settings-logo" src={value.logo} alt="" /> : 'The bundled crest'}</dd>
    </dl>
  );
}

/**
 * Edits the unit settings, including a logo upload.
 * @param {{draft: !Object, setDraft: function(!Object): void, errors: !Array<!Object>}} props
 *     The editor props.
 * @returns {!preact.VNode} The form fields.
 */
export function UnitEditor({ draft, setDraft, errors }) {
  /**
   * Reads the chosen file into a data URL.
   * @param {!Event} event The change event.
   * @returns {void}
   */
  function onLogo(event) {
    const file = event.currentTarget.files && event.currentTarget.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft({ ...draft, logo: String(reader.result) });
    reader.readAsDataURL(file);
  }

  return (
    <>
      <Field label="Unit name" error={errorAt(errors, 'name')}>
        <input class="field" value={draft.name} onInput={(e) => setDraft({ ...draft, name: e.currentTarget.value })} />
      </Field>
      <Field label="Page title" error={errorAt(errors, 'pageTitle')}>
        <input class="field" value={draft.pageTitle} onInput={(e) => setDraft({ ...draft, pageTitle: e.currentTarget.value })} />
      </Field>
      <Field label={'Logo (PNG, JPEG, WebP or SVG, up to ' + Math.floor((MAX_LOGO_CHARS * 3) / 4 / 1024) + ' KB)'} error={errorAt(errors, 'logo')}>
        <input class="field" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={onLogo} />
      </Field>
      {draft.logo ? (
        <p>
          <img class="settings-logo" src={draft.logo} alt="The new logo" />{' '}
          <button class="button button--quiet" type="button" onClick={() => setDraft({ ...draft, logo: '' })}>
            Use the bundled crest
          </button>
        </p>
      ) : null}
    </>
  );
}

/**
 * Shows the calendar: holidays with their weekday, and rotations.
 * @param {{value: !Object}} props The calendar section.
 * @returns {!preact.VNode} The view.
 */
export function CalendarView({ value }) {
  return (
    <>
      <h4 class="settings-subhead">Public holidays</h4>
      {value.holidays.length === 0 ? (
        <EmptyState>No public holidays are set.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'date', label: 'Date' },
            { key: 'weekday', label: 'Weekday' },
            { key: 'name', label: 'Name' },
          ]}
          rows={value.holidays.map((h) => ({ date: fmtDate(h.date), weekday: weekdayOf(h.date).name, name: h.name }))}
          rowKey={(row) => row.date}
        />
      )}
      <h4 class="settings-subhead">Rotations</h4>
      {value.rotations.length === 0 ? (
        <EmptyState>No rotations are set. Rotational grouping is unavailable.</EmptyState>
      ) : (
        <DataTable
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'start', label: 'Start' },
            { key: 'end', label: 'End' },
          ]}
          rows={value.rotations.map((r) => ({ name: r.name, start: fmtDate(r.start), end: fmtDate(r.end) }))}
          rowKey={(row) => row.name + row.start}
        />
      )}
    </>
  );
}

/**
 * Edits holidays and rotations as lists of rows.
 * @param {{draft: !Object, setDraft: function(!Object): void, errors: !Array<!Object>}} props
 *     The editor props.
 * @returns {!preact.VNode} The form fields.
 */
export function CalendarEditor({ draft, setDraft, errors }) {
  const holidays = draft.holidays;
  const rotations = draft.rotations;
  return (
    <>
      <h4 class="settings-subhead">Public holidays</h4>
      {errorAt(errors, 'holidays') ? <Banner tone="error">{errorAt(errors, 'holidays')}</Banner> : null}
      {holidays.map((holiday, i) => (
        <div class="listrow" key={i}>
          <Field label="Date" error={errorAt(errors, 'holidays.' + i + '.date')}>
            <input class="field" type="date" value={holiday.date} onInput={(e) => setDraft({ ...draft, holidays: patchAt(holidays, i, { date: e.currentTarget.value }) })} />
          </Field>
          <Field label="Name" error={errorAt(errors, 'holidays.' + i + '.name')}>
            <input class="field" value={holiday.name} onInput={(e) => setDraft({ ...draft, holidays: patchAt(holidays, i, { name: e.currentTarget.value }) })} />
          </Field>
          <button class="button button--quiet" type="button" aria-label={'Remove holiday ' + (i + 1)} onClick={() => setDraft({ ...draft, holidays: holidays.filter((_, j) => j !== i) })}>
            Remove
          </button>
        </div>
      ))}
      <button class="button" type="button" onClick={() => setDraft({ ...draft, holidays: [...holidays, { date: '', name: '' }] })}>
        Add holiday
      </button>

      <h4 class="settings-subhead">Rotations</h4>
      {errorAt(errors, 'rotations') ? <Banner tone="error">{errorAt(errors, 'rotations')}</Banner> : null}
      {rotations.map((rotation, i) => (
        <div class="listrow" key={i}>
          <Field label="Name" error={errorAt(errors, 'rotations.' + i + '.name')}>
            <input class="field" value={rotation.name} onInput={(e) => setDraft({ ...draft, rotations: patchAt(rotations, i, { name: e.currentTarget.value }) })} />
          </Field>
          <Field label="Start" error={errorAt(errors, 'rotations.' + i + '.start')}>
            <input class="field" type="date" value={rotation.start} onInput={(e) => setDraft({ ...draft, rotations: patchAt(rotations, i, { start: e.currentTarget.value }) })} />
          </Field>
          <Field label="End" error={errorAt(errors, 'rotations.' + i + '.end')}>
            <input class="field" type="date" value={rotation.end} onInput={(e) => setDraft({ ...draft, rotations: patchAt(rotations, i, { end: e.currentTarget.value }) })} />
          </Field>
          <button class="button button--quiet" type="button" aria-label={'Remove rotation ' + (i + 1)} onClick={() => setDraft({ ...draft, rotations: rotations.filter((_, j) => j !== i) })}>
            Remove
          </button>
        </div>
      ))}
      <button class="button" type="button" onClick={() => setDraft({ ...draft, rotations: [...rotations, { name: '', start: '', end: '' }] })}>
        Add rotation
      </button>
    </>
  );
}

/**
 * Shows the thresholds.
 * @param {{value: !Object}} props The thresholds section.
 * @returns {!preact.VNode} The view.
 */
export function ThresholdsView({ value }) {
  return (
    <dl class="settings-list">
      <dt>Long-term MC</dt>
      <dd>{value.longMcDays} days or longer</dd>
      <dt>Leaderboard size</dt>
      <dd>Top {value.leaderboardSize}</dd>
    </dl>
  );
}

/**
 * Edits the thresholds.
 * @param {{draft: !Object, setDraft: function(!Object): void, errors: !Array<!Object>}} props
 *     The editor props.
 * @returns {!preact.VNode} The form fields.
 */
export function ThresholdsEditor({ draft, setDraft, errors }) {
  return (
    <>
      <Field label="Long-term MC: days or longer" error={errorAt(errors, 'longMcDays')}>
        <input class="field" type="number" min="1" max="365" value={draft.longMcDays} onInput={(e) => setDraft({ ...draft, longMcDays: numberFrom(e) })} />
      </Field>
      <Field label="Leaderboard size" error={errorAt(errors, 'leaderboardSize')}>
        <input class="field" type="number" min="1" max="100" value={draft.leaderboardSize} onInput={(e) => setDraft({ ...draft, leaderboardSize: numberFrom(e) })} />
      </Field>
    </>
  );
}

/**
 * Shows the session settings.
 * @param {{value: !Object}} props The session section.
 * @returns {!preact.VNode} The view.
 */
export function SessionView({ value }) {
  return (
    <dl class="settings-list">
      <dt>Login lasts</dt>
      <dd>{value.ttlHours} hours (applies from the next login)</dd>
      <dt>Refresh every</dt>
      <dd>{value.refreshSeconds} seconds</dd>
    </dl>
  );
}

/**
 * Edits the session settings.
 * @param {{draft: !Object, setDraft: function(!Object): void, errors: !Array<!Object>}} props
 *     The editor props.
 * @returns {!preact.VNode} The form fields.
 */
export function SessionEditor({ draft, setDraft, errors }) {
  return (
    <>
      <Field label="Login lasts (hours)" error={errorAt(errors, 'ttlHours')}>
        <input class="field" type="number" min="1" max="72" value={draft.ttlHours} onInput={(e) => setDraft({ ...draft, ttlHours: numberFrom(e) })} />
      </Field>
      <Field label="Refresh every (seconds)" error={errorAt(errors, 'refreshSeconds')}>
        <input class="field" type="number" min="15" max="3600" value={draft.refreshSeconds} onInput={(e) => setDraft({ ...draft, refreshSeconds: numberFrom(e) })} />
      </Field>
    </>
  );
}
```

- [ ] **Step 3: Write `src/pages/settings/UnlockPanel.jsx`**

```jsx
/**
 * Where a viewer reading with the dashboard password unlocks editing with the settings
 * password, without logging out. The field clears as soon as its value is captured, as the
 * login field does.
 */

import { useState } from 'preact/hooks';
import { refresh } from '../../app/auth.js';
import { Banner, Card } from '../../components/Card.jsx';
import { unlockEditing } from '../../data/session.js';

/**
 * The unlock card.
 * @returns {!preact.VNode} The card.
 */
export function UnlockPanel() {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * Sends the typed password and clears the field either way.
   * @param {!Event} event The submit event.
   * @returns {!Promise<void>} Resolves when done.
   */
  async function onSubmit(event) {
    event.preventDefault();
    const value = typed;
    setTyped('');
    setBusy(true);
    setError('');
    try {
      await unlockEditing(value);
      await refresh();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Editing is locked" note="You can read every setting">
      <form class="settings-form settings-form--inline" onSubmit={onSubmit}>
        <label class="visually-hidden" for="settings-password">
          Settings password
        </label>
        <input
          class="field"
          id="settings-password"
          type="password"
          autocomplete="current-password"
          placeholder="Settings password"
          value={typed}
          disabled={busy}
          onInput={(e) => setTyped(e.currentTarget.value)}
        />
        <button class="button button--primary" type="submit" disabled={busy || typed === ''}>
          {busy ? 'Unlocking' : 'Unlock editing'}
        </button>
      </form>
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Card>
  );
}
```

- [ ] **Step 4: Rebuild `src/pages/Settings.jsx` around the two tabs**

Keep `DataQualityPanel` as is. Delete `HolidaysPanel` and `RotationsPanel` (their tables now live in `CalendarView`); keep `RotationsPanel`'s gap/overlap banners by rendering `rotationIssues(toRotations(data.rotations))` under the Calendar card (see below). Replace the imports and `Settings()` with:

```jsx
import { useState } from 'preact/hooks';
import { canEdit, dataset } from '../app/state.js';
import { Banner } from '../components/Card.jsx';
import { Segmented } from '../components/Segmented.jsx';
import { fmtDate, fmtFraction, fmtInt } from '../format.js';
import { dataQuality } from '../model/quality.js';
import { rotationIssues, toRotations } from '../model/rotations.js';
import { SECTIONS } from '../model/settings/defaults.js';
import { SectionCard } from './settings/SectionCard.jsx';
import {
  CalendarEditor,
  CalendarView,
  SessionEditor,
  SessionView,
  ThresholdsEditor,
  ThresholdsView,
  UnitEditor,
  UnitView,
} from './settings/editors.jsx';
import { UnlockPanel } from './settings/UnlockPanel.jsx';

/**
 * The view and editor for each section; a section without an entry is not shown yet.
 * @type {!Object<string, {View: function(!Object): !preact.VNode, Editor: function(!Object): !preact.VNode}>}
 */
const EDITORS = {
  unit: { View: UnitView, Editor: UnitEditor },
  calendar: { View: CalendarView, Editor: CalendarEditor },
  thresholds: { View: ThresholdsView, Editor: ThresholdsEditor },
  session: { View: SessionView, Editor: SessionEditor },
};

/** @type {!Array<{name: string, label: string}>} The two tabs. */
const TIERS = [
  { name: 'basic', label: 'Basic' },
  { name: 'advanced', label: 'Advanced' },
];

/**
 * The Settings page.
 * @returns {!preact.VNode} The page.
 */
export function Settings() {
  const [tier, setTier] = useState('basic');
  const data = dataset.value;
  if (!data) {
    return null;
  }
  const quality = dataQuality(data);
  const sections = SECTIONS.filter((section) => section.tier === tier && EDITORS[section.name]);
  const calendarIssues = rotationIssues(toRotations(data.rotations));

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Settings</h1>
          <p class="pagehead__sub">What this dashboard is set up for, and how much of the battalion it covers.</p>
        </div>
        <Segmented options={TIERS} value={tier} onChange={setTier} label="Settings tier" radio />
      </header>

      {canEdit.value ? null : <UnlockPanel />}

      {tier === 'advanced' ? (
        <Banner tone="warning">
          These change how the dashboard runs, and in later releases how messages and forms are read. Review each change before saving.
        </Banner>
      ) : null}

      <div class="grid-2">
        {sections.map(({ name, label }) => (
          <SectionCard
            key={name}
            section={name}
            title={label}
            value={data.settings[name]}
            meta={data.settingsMeta[name]}
            View={EDITORS[name].View}
            Editor={EDITORS[name].Editor}
          />
        ))}
      </div>

      {tier === 'basic' && calendarIssues.length > 0 ? (
        <div class="band">
          {calendarIssues.map((issue, index) => (
            <Banner tone={issue.kind === 'invalid' ? 'error' : 'warning'} key={index}>
              {issue.message}
            </Banner>
          ))}
        </div>
      ) : null}

      {tier === 'basic' ? <DataQualityPanel quality={quality} /> : null}
    </div>
  );
}
```

Remove imports that are no longer used (`Card`, `EmptyState`, `DataTable`, `toHolidays`, `rotationSpan`, `weekdayOf`); keep what `DataQualityPanel` uses (`Card`, `Banner`, `fmtDate`, `fmtFraction`, `fmtInt`). Update the module header: the page shows every setting to any viewer, lets someone holding the settings password edit, and says which sections are defaults.

- [ ] **Step 5: Add form styles to `src/theme/components.css`**

Inputs reuse the repo's existing input class `.field` and label class `.field__label` (`src/theme/controls.css`), as the Deposit page does; the wrapper is `.settings-field` so it does not collide with `.field`. Use only tokens from `src/theme/tokens.css` (`--space-xs/sm/md`, `--ink-muted`, `--critical`, `--hairline`). Append:

```css
/* Settings forms: a column of labelled fields, list rows that wrap on a phone. */
.settings-form { display: flex; flex-direction: column; gap: var(--space-md); }
.settings-form--inline { flex-direction: row; flex-wrap: wrap; align-items: center; }
.settings-form__actions { display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-top: var(--space-sm); }
.settings-field { display: flex; flex-direction: column; gap: var(--space-xs); min-width: 0; }
.settings-field__error { font-size: 13px; color: var(--critical); }
.listrow { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: flex-end; padding-bottom: var(--space-sm); border-bottom: 1px solid var(--hairline); }
.listrow .settings-field { flex: 1 1 140px; }
.settings-subhead { margin: var(--space-md) 0 var(--space-xs); font-size: 15px; }
.settings-list { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-xs) var(--space-md); margin: 0; }
.settings-list dt { color: var(--ink-muted); }
.settings-list dd { margin: 0; }
.settings-logo { max-height: 48px; vertical-align: middle; }
```

Check `.field`'s width rules in `controls.css`; if it sets a fixed width, add `.settings-field .field { width: 100%; }`.

- [ ] **Step 6: Build and test**

Run: `bun run build` then `bun test ./test/`
Expected: build succeeds; tests PASS.

- [ ] **Step 7: Verify by hand**

The Vite dev server has no `/api` routes, so verify on a Vercel preview deployment of the branch. **Ask the user before pushing the branch** (pushing publishes it). With `SETTINGS_PASSWORD` set on the preview environment and the migrations applied to its database, check:
1. Log in with `DASHBOARD_PASSWORD`: Settings shows every section read-only, with "Editing is locked"; there is no Edit button.
2. Unlock with `DASHBOARD_PASSWORD` in the unlock field: an error says it opens the dashboard but not editing.
3. Unlock with `SETTINGS_PASSWORD`: Edit buttons appear.
4. Unit: rename to "41 SAR", upload a small PNG, save. The sidebar, the header, the browser tab title and the Duty page's root card follow after the refresh.
5. Calendar: add a holiday with no name; the error shows beside the field. Add two overlapping rotations, save; the warning shows. A holiday line appears on the Overview trend.
6. Thresholds: set leaderboard size 3; the category pages' leaderboards show 3 rows. Set long-term MC to 7; the card title reads "≥7 days".
7. Open Settings in a second tab, save Unit in the first, then save Unit in the second: "Someone else saved this section."
8. Reset Unit to defaults: back to "40 SAR" and the bundled crest.
9. At phone width (375px), the list rows wrap and nothing scrolls sideways.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Settings.jsx src/pages/settings/SectionCard.jsx src/pages/settings/editors.jsx src/pages/settings/UnlockPanel.jsx src/theme/components.css
git commit -m "feat(settings): Basic/Advanced Settings page with section editors and unlock"
```

---

### Task 10: End-to-end check, docs, environment and rollout

**Files:**
- Modify: `test/e2e/workflows.test.ts`, `.env.example`, `docs/architecture_patterns.md`, `docs/dashboard.md`, `tasks/todo.md`, `docs/superpowers/specs/2026-09-24-user-settings-design.md`

**Interfaces:**
- Consumes: everything above; `SETTINGS_PASSWORD` from `test/support/app.ts`.
- Produces: docs and a rollout checklist.

- [ ] **Step 1: Write the end-to-end test**

In `test/e2e/workflows.test.ts`, import `SETTINGS_PASSWORD` from `../support/app.ts` and `saveSection` from `../../src/data/settings.js`, then add (inside the file's existing `describe.skipIf(!hasTestDb)` structure, reusing its `app` setup and teardown):

```ts
describe.skipIf(!hasTestDb)('settings, end to end', () => {
  let app: RunningApp;
  beforeEach(async () => {
    await resetTestDb();
    app = startApp(await resetTestDb());
  }, DB_TIMEOUT_MS);
  afterEach(() => {
    forgetCookies(app.origin);
    app.stop();
  });

  test('the read-only password cannot save; the settings password can, and every reader sees it', async () => {
    await unlock(app.origin);
    const refused = await withOrigin(app.origin, () =>
      saveSection('calendar', { holidays: [{ date: '2026-08-09', name: 'National Day' }], rotations: [] }, 0),
    ).catch((error: any) => error);
    expect(refused.status).toBe(401);

    await unlock(app.origin, SETTINGS_PASSWORD);
    await withOrigin(app.origin, () =>
      saveSection('calendar', { holidays: [{ date: '2026-08-09', name: 'National Day' }], rotations: [] }, 0),
    );

    forgetCookies(app.origin);
    await unlock(app.origin);
    const data: any = await withOrigin(app.origin, () => loadAll());
    expect(data.canEdit).toBe(false);
    expect(data.holidays).toEqual([{ date: '2026-08-09', name: 'National Day' }]);
  }, E2E_TIMEOUT_MS);
});
```

Match the file's existing `beforeEach`/`afterEach` style for `startApp`; if the file already starts one app per test in a shared `describe`, put this test there instead of a new block.

- [ ] **Step 2: Run it**

Run: `bun test test/e2e/workflows.test.ts`
Expected: PASS (with `TEST_DATABASE_URL`).

- [ ] **Step 3: Document the new password**

In `.env.example`, under `# --- Dashboard ---`, change the `DASHBOARD_PASSWORD` comment to: "The read-only password: every page, and depositing parade states. /api/dashboard and /api/parade check it. Long; no route has a lockout." Then add:

```
# The read-write password: everything DASHBOARD_PASSWORD does, plus changing settings.
# Must differ from DASHBOARD_PASSWORD; unset (or equal), nobody can edit settings.
SETTINGS_PASSWORD=
```

- [ ] **Step 4: Update `docs/architecture_patterns.md`**

- Layout table, `db/` row: replace "`public_holidays` and `rotations` are dashboard settings maintained by SQL" with "`settings` holds one JSONB row per Settings-page section".
- Layout table, `lib/` row: add "`settings.ts` (read, save and reset settings sections)".
- Add a row: `api/settings.ts` | Vercel Function | Saves and resets one settings section: PUT/DELETE, the `settings_session` cookie (from `SETTINGS_PASSWORD`) and a same-origin request; validates with `src/model/settings/validate.js`.
- `api/dashboard.ts` row: "…answers every tab from `lib/dashboard.ts#loadTabs` and the settings in force from `lib/settings.ts#readSettings`, plus `canEdit`".
- `api/session.ts` row: "…accepts `DASHBOARD_PASSWORD` (read) or `SETTINGS_PASSWORD` (read-write, which also sets `settings_session`); the session's length comes from the Session settings".
- Rules: add "**One write path for settings.** `settings` rows are written only by `api/settings.ts`. Shared settings code (`src/model/settings/`) is pure JavaScript used by both the browser and the server; the server passes settings as values and never uses `active.js`." Change "The browser holds a session, never the password" to describe the two cookies and that `SETTINGS_PASSWORD` equal to `DASHBOARD_PASSWORD` grants nobody editing.
- Dashboard section: note `model/settings/` (defaults, validation, resolution, the active settings `data/feed.js` sets).

- [ ] **Step 5: Update `docs/dashboard.md` section 5**

Replace the "Holidays and rotations" paragraphs (lines ~105-112) with: holidays and rotations are edited under Settings → Calendar by someone holding the settings password; until they are set, the Settings page says so, no holiday lines are drawn, and there is no rotational grouping. Mention Unit, Thresholds and Session in one sentence, and the Basic/Advanced split.

- [ ] **Step 6: Add the rollout checklist to `tasks/todo.md`**

Add a section:

```markdown
## Settings, phase 1 rollout
- [ ] Before merging: check production `public_holidays` has the 2027 holidays; if not, run the old `db/seed-public-holidays.sql` from `main` against production first (the migration carries whatever the table holds into Settings → Calendar, then drops it).
- [ ] Set `SETTINGS_PASSWORD` on Vercel (long, different from `DASHBOARD_PASSWORD`).
- [ ] `bun run db:migrate` (applies 0002 settings + copy, 0003 drop).
- [ ] Re-run `bun --env-file=.env.local scripts/apply-grants.ts db/grants-dashboard.sql` so `dashboard_read` can select `settings`; keep the printed URL.
- [ ] Deploy; on production, check Settings → Calendar lists every holiday and rotation that was in the old tables, and the charts still draw holiday lines.
```

- [ ] **Step 7: Record the migration check in the spec**

In the spec's Testing list, replace "DB suite: migration moves holidays and rotations, converts `company` to text, keeps rows." with "The calendar copy (0002) is checked on production during rollout (`tasks/todo.md`); the `company` conversion (phase 2) gets a DB test."

- [ ] **Step 8: Full verification**

Run: `bun test ./test/`, `bunx tsc --noEmit`, `bun run build`
Expected: all PASS / no errors. Report the counts.

- [ ] **Step 9: Commit**

```bash
git add test/e2e/workflows.test.ts .env.example docs/architecture_patterns.md docs/dashboard.md tasks/todo.md docs/superpowers/specs/2026-09-24-user-settings-design.md
git commit -m "docs(settings): architecture, env, rollout; end-to-end settings check"
```
