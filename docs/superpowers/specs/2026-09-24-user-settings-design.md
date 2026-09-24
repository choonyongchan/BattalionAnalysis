# User-editable settings — design

Date: 2026-09-24 · Status: awaiting review

## Goal

Make the project last from batch to batch, and let a new battalion adopt it, without code
changes. Everything a new user may need to change moves out of code into settings that are
edited on the dashboard's Settings page, split into **Basic** and **Advanced**.

Success means: a fresh deployment with an empty `settings` table behaves exactly as today; an
admin can set up a new batch (holidays, rotations, companies) and a new battalion (name, logo,
ORBAT, form wording, vocabularies) from the browser; and an Advanced change shows its impact
before it is saved.

## Decisions (agreed)

| Topic | Decision |
|---|---|
| Where settings live | Everything in the database, edited on the Settings page |
| Access | `DASHBOARD_PASSWORD` stays; it is read-only for settings. New `SETTINGS_PASSWORD` is read-write. Deposit (parade-state deposit/edit/delete) keeps working on `DASHBOARD_PASSWORD` |
| Vocabulary format | Plain word lists; code builds escaped whole-word patterns. Impact preview before saving |
| History | One global settings set. Companies and sub-units are retired, never deleted |
| Storage | One `settings` table, one JSONB row per section |
| Naming | The ORBAT concept is renamed **Duty** everywhere in the dashboard |

## Stays in code on purpose

NRIC exclusion rules; the six fixed section *types* (`reason_category`: Att C, Status, Report
Sick, MA, Off/Leave, Others) and the enums that mirror them; the Singapore time offset; the
`num_days = 999` permanent-status sentinel; secrets and connection strings (env vars).

## 1. Storage, access and data flow

### Table

```sql
CREATE TABLE settings (
  section    text PRIMARY KEY,
  value      jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

- A missing row means "use the defaults". Defaults live in code and equal today's hardcoded
  values.
- The migration moves `public_holidays` and `rotations` rows into the `calendar` section, then
  drops both tables (and their grants).
- `parade_submissions.company` and `report_sick_formsg.company` change from `companyEnum` to
  `text`; the `company` Postgres enum is dropped. The write paths check a company against the
  Duty section's **active** companies instead. A retired company is not accepted: a parade
  state (relayed, deposited or edited) naming one fails validation and is stored as
  `Needs review`, like any other unknown company; a FormSG submission whose `Unit & Coy`
  matches only a retired company is stored with `company` null, as an unmatched answer is
  today, so no webhook delivery is lost. Rows already stored under a retired company stay,
  and the dashboard still charts them.
- `dashboard_read` gets `SELECT` on `settings`.

### Shared modules

The pure part runs in both the browser and the server, so it lives in `src/model/settings/`
as JavaScript, following the existing precedent of `lib/dashboard.ts` importing
`src/model/domain.js` (and keeping `model/`'s rule that it imports only `model/`):

- `src/model/settings/defaults.js` — the section registry (name, tier, label) and the default
  value of every section.
- `src/model/settings/validate.js` — one validator per section, returning the cleaned value and
  field-addressed errors and warnings. Imported by the API, the parser, FormSG intake and the
  dashboard, so all agree.
- `src/model/settings/resolve.js` — merges stored rows over the defaults, falling back to the
  default for any section that is missing or invalid (reporting which).
- `src/model/settings/active.js` — the browser's active settings (see "Who reads settings").
- `src/model/settings/patterns.js` (phase 3) — builds escaped, case-insensitive, whole-word
  regexes from word lists; a space inside a word also matches no space (`light duty` matches
  `LIGHTDUTY`).

The database part is server-only: `lib/settings.ts` reads, saves (optimistic on `version`) and
resets sections.

### Access

- Login keeps one password field. `api/session.ts` accepts either password. A match on
  `SETTINGS_PASSWORD` issues the normal `dashboard_session` cookie **and** a
  `settings_session` cookie signed with `SETTINGS_PASSWORD`, so rotating that password ends
  every edit session.
- A read-only session can unlock editing by posting `SETTINGS_PASSWORD` to the same route,
  which adds the second cookie without logging out.
- Unset `SETTINGS_PASSWORD`, or one equal to `DASHBOARD_PASSWORD`, ⇒ every settings write is
  refused (fail closed): equal passwords would make the read-only password read-write.

### Who reads settings

- **Dashboard:** `api/dashboard.ts` returns the resolved settings alongside the tabs.
- **Parser / FormSG:** `api/parade.ts` and `api/formsg.ts` call `loadSettings` once per request
  and pass the result explicitly into `lib/parser/*`, `lib/domain.ts` and `lib/formsg/*`.
  Server code takes settings as a **parameter**, never a module global, because requests run
  concurrently.
- **Browser model:** `src/model/settings/active.js` holds the active settings, set once by
  `app/state.js` when the feed loads, with defaults until then. `model/` files read through its
  accessors (`companies()`, `subunitsOf(company)`, …) in place of today's constants
  (`COMPANIES` has ~15 importers). Tests set and reset it with a helper. This keeps `model/`
  free of DOM and network while avoiding threading a parameter through every call.
- **WhatsApp bridge:** fetches `GET /api/settings?section=whatsapp` with its existing bearer
  `PARADE_INGEST_SECRET`, refreshes every 5 minutes, keeps the last good copy on failure, and
  starts from defaults.

### Route `api/settings.ts`

Writes require the `settings_session` cookie and a same-origin request.

| Method | Does |
|---|---|
| `GET` (phase 4) | Every section, defaults filled in, with `version` and an `isDefault` flag. The bridge's bearer may read `section=whatsapp` only. Until then the dashboard gets settings from `/api/dashboard` |
| `PUT {section, value, version}` | Validate, then write. A stale `version` returns 409 |
| `POST ?preview {section, value}` | Returns the impact report (section 3) without writing |
| `POST ?reparse` | Re-parses stored messages that need review, with the current settings |
| `DELETE ?section=&version=` | Deletes the row, resetting the section to defaults (same version check) |

## 2. Sections

All word lists are case-insensitive whole words. Defaults equal today's values.

### Basic

| Section | Holds | Replaces |
|---|---|---|
| `unit` | `name` ("40 SAR"), `pageTitle` ("40 SAR Personnel"), `logo` (data URL ≤ 200 KB; blank = bundled logo) | `index.html`, `Sidebar.jsx`, `Shell.jsx`, `Logo.jsx`, `orbat.js`, `Orbat.jsx`, `prompt.ts`, Deposit placeholder |
| `calendar` | `holidays[{date, name}]` (name required), `rotations[{name, start, end}]` | `public_holidays`, `rotations` tables; `SG_PUBLIC_HOLIDAYS` map in `calendarMarks.js` (deleted) |
| `duty` | `companies[{name, formsgLabel, retired, subunits[]}]` in parade order; `commandRoles` (["CDO","CDS","COS"]; PDS implicit, one per sub-unit) | `companyEnum`; `COMPANIES`, `COMPANY_SUBUNITS`, `COMMAND_ROLES` in `src/model/domain.js`; `companyFromUnitCoy` matching |
| `thresholds` | `longMcDays` 14 (an MC this long or longer is long-term), `leaderboardSize` 10 | `LONG_MC_MIN_DAYS = 13` and the leaderboard limits in `pages/shared/category.jsx`; `limit \|\| 10` in `leaderboards.js`, `formsg.js` |

`DEFAULT_PROJECTION_DAYS` and `OUTLIER_Z` are not settings: the "Next 7 Days" heading does not
filter anything and no page shows `isOutlier`, so a setting for either would change nothing.

`PLATOONS` and `SUBUNIT_POSITIONS` (heatmap columns) are derived from the Duty section: the
column count is the largest company's sub-unit count.

### Advanced

| Section | Holds | Replaces |
|---|---|---|
| `formsg` | `titles` (column → question titles), `reportSickTypes` (RSI/RSO/MR/FFI → option texts), `outcomes` (MC/Status/Both/None → option prefixes), `symptomCategories` (verbatim) | `TITLE_MAP`, `REPORT_SICK_TYPES`, `toOutcome` in `lib/formsg/fields.ts`; `CLINICAL_BUCKETS` in `symptoms.js` |
| `classification` | `statusBuckets[{name, keywords[]}]` (report order; "Other" automatic), `locations[{canonical, aliases[]}]`, `symptomWords`, `stopwords`, `fourDPlaceholders`, `fourDPlatoonDigits` | `statusBuckets.js`, `locations.js`, `classify.js` lexicons, `FOUR_D_PLACEHOLDERS`, `platoon.js` digit rule |
| `parser` | `ranks` (expanded: 1SG, 2SG, 3SG, ME1…ME8), `dutyWords`, `sectionHeaders` (words naming each of the six fixed sections), `promptNotes` (free text appended to the LLM prompt) | `RANK`, `DUTY_WORD`, `SECTION_LINE` in `deterministic.ts`; `prompt.ts` |
| `whatsapp` | `firstParadeMarkers`, `lastParadeMarkers` | patterns in `whatsapp/src/signature.js` |
| `session` | `ttlHours` 12, `refreshSeconds` 60 | `SESSION_TTL_MS`, `REFRESH_MS` |

### Validation (shared)

Errors block a save: missing required fields; duplicate names within a list; empty words;
non-ISO dates; a rotation that starts after it ends; numbers out of bounds (e.g. `longMcDays`
1–365, `leaderboardSize` 1–100, `ttlHours` 1–72, `refreshSeconds` 15–3600); a Duty save that **drops** a company or sub-unit present in the stored
value (retire it instead); a logo over 200 KB or not an image.

Warnings do not block: rotation gaps and overlaps (today's `rotationIssues`).

## 3. Settings page

- Two tabs: **Basic** (Unit, Calendar, Duty, Thresholds, then the existing data-quality panel)
  and **Advanced** (FormSG, Classification, Parser, WhatsApp, Session) with a standing banner:
  "These change how messages and forms are read. Review the preview before saving."
- Read-only session: every value visible, plus an **Unlock editing** field.
- Each section is a card with a view mode ("Default" badge when untouched) and an edit mode
  (Save, Cancel, Reset to defaults). Editors: list rows (add, remove, drag to reorder), word
  chips, native date/number inputs, logo upload with preview. Errors sit beside their field. A
  409 reads "Someone else saved this section. Reload to see their version."

### Impact preview (required before saving any Advanced section and Duty)

| Section | Shows | Runs |
|---|---|---|
| Classification | Rows moving between Status buckets; clinics renamed or merged; symptom-word changes; platoons inferred differently | Browser, over loaded data (pure `model/`) |
| Parser | Latest 300 stored messages re-parsed by the rules only (no LLM, no cost): counts of parsed → needs review, needs review → parsed, rows would differ, listed by `parade_response_id` | Server; no message text leaves the database |
| WhatsApp | Recent stored headers whose accept/reject would flip | Server |
| FormSG | Stored submissions whose symptom answer would fall to "Other". Title changes cannot be previewed (raw payloads are not stored); a warning says so | Server |
| Duty | Companies added or retired; sub-unit changes; stored rows naming a company no longer listed (blocks the save) | Server |

Other Basic sections save directly.

### Effect on past data

Dashboard-side settings (classification, thresholds, calendar, Duty) apply to all data at
once, because they are computed at read time. Parser settings apply to new messages; after a
save the page offers **Re-parse N messages that need review**. Messages already parsed are left
alone, keeping the `already_parsed` rule.

### Duty rename

Route `/orbat` → `/duty` (old path redirects); `pages/Orbat.jsx` → `pages/Duty.jsx`;
`model/orbat.js` → `model/duty.js`; `test/dashboard/orbat.test.js` → `duty.test.js`; sidebar,
icon name, headings, CSS class names and `docs/dashboard.md` follow.

## 4. Errors, testing, rollout

### Errors

- An invalid stored row (e.g. hand-edited in SQL) falls back to that section's defaults; the
  server logs only the section name, and the Settings page shows an error banner on it.
- Bridge settings fetch failure: keep the last good copy, else defaults; log once per failure
  streak.
- Nothing logs a setting's value (a word list can quote a personnel line).

### Testing

- `src/model/settings/defaults.js` pinned to today's constants, so behaviour is unchanged by default.
- Validators and `patterns.ts` (escaping, whole words, space-optional) — pure suites.
- Every existing model, parser and FormSG suite passes unchanged against defaults; new cases
  run each with a non-default setting (a sixth company, a renamed Status bucket, a new duty
  word, a reworded form title).
- `api/settings.ts` refusals before touching the store: no cookie, read-only cookie, wrong or
  unset `SETTINGS_PASSWORD`, cross-site write, stale version, invalid value, bearer reading a
  section other than `whatsapp`.
- Preview responses never contain a message body (asserted like the existing NRIC/body guards).
- The calendar copy (0002) is checked on production during rollout (`tasks/todo.md`); the
  `company` conversion (phase 2) gets a DB test.
- E2E: save a Status-bucket change and see the dashboard reflect it; add a company and ingest a
  parade state for it; retire a company and see its next parade state stored as `Needs review`
  and its FormSG submission stored with `company` null, while its past rows still chart.

### Rollout — one spec, four shippable phases

1. **Foundation:** `settings` table and migrations, `src/model/settings/` and `lib/settings.ts`, the two-password session,
   `api/settings.ts` (GET/PUT/DELETE), Settings page tabs and cards; sections `unit`,
   `calendar`, `thresholds`, `session`.
2. **Duty:** `company` enum → text, `duty` section and its preview, browser accessors replacing
   `COMPANIES` and friends, the ORBAT → Duty rename.
3. **Classification and FormSG:** both sections and their previews.
4. **Parser and WhatsApp:** both sections, server preview, re-parse action, bridge fetch.

Each phase updates `docs/architecture_patterns.md`, `.env.example` (`SETTINGS_PASSWORD`) and
`db/grants-dashboard.sql` as it touches them.
