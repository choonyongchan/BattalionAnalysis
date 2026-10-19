/**
 * The view and the form for each Phase 1 section.
 *
 * Every editor takes `{ draft, setDraft, errors }`: the value being edited, a setter taking the
 * next whole value, and the field errors to show beside each input. Numbers are read from
 * inputs as numbers, so the validator sees what the server will.
 */

import { Banner, EmptyState } from '../../components/Card.tsx';
import { DataTable } from '../../components/Table.tsx';
import { fmtDate } from '../../format.ts';
import { weekdayOf } from '../../../../shared/dates.ts';
import { MAX_LOGO_CHARS, errorAt, type FieldMessage } from '../../../../shared/settings/validate.ts';
import type { ComponentChildren } from 'preact';
import type { SectionName, SettingsValues } from '../../../../shared/settings/defaults.ts';

/** A section's value while edited: a number field may hold raw text until the validator refuses it. */
export type Draft<S extends SectionName> = {
  [K in keyof SettingsValues[S]]: SettingsValues[S][K] extends number ? number | string : SettingsValues[S][K];
};

/** What every section view receives. */
export interface ViewProps<S extends SectionName> {
  value: SettingsValues[S];
}

/** What every section editor receives. */
export interface EditorProps<S extends SectionName> {
  draft: Draft<S>;
  setDraft: (draft: Draft<S>) => void;
  errors: FieldMessage[];
}

/** A labelled input with its error beneath. */
export function Field({ label, error, children }: { label: string; error?: string; children: ComponentChildren }) {
  return (
    <label class="settings-field">
      <span class="field__label">{label}</span>
      {children}
      {error ? <span class="settings-field__error">{error}</span> : null}
    </label>
  );
}

/** Reads a number input: a whole number, or the raw text so the validator can refuse it. */
function numberFrom(event: { currentTarget: HTMLInputElement }): number | string {
  const text = event.currentTarget.value;
  return text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : text;
}

/** Replaces one item of a list field. */
function patchAt<T>(list: T[], index: number, patch: Partial<T>): T[] {
  return list.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

/** Shows the unit settings. */
export function UnitView({ value }: ViewProps<'unit'>) {
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

/** Edits the unit settings, including a logo upload. */
export function UnitEditor({ draft, setDraft, errors }: EditorProps<'unit'>) {
  /** Reads the chosen file into a data URL. */
  function onLogo(event: { currentTarget: HTMLInputElement }) {
    const file = event.currentTarget.files?.[0];
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

/** Shows the calendar: holidays with their weekday, and rotations. */
export function CalendarView({ value }: ViewProps<'calendar'>) {
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
          rows={value.holidays.map((holiday) => ({ date: fmtDate(holiday.date), weekday: weekdayOf(holiday.date).name, name: holiday.name }))}
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
          rows={value.rotations.map((rotation) => ({ name: rotation.name, start: fmtDate(rotation.start), end: fmtDate(rotation.end) }))}
          rowKey={(row) => row.name + row.start}
        />
      )}
    </>
  );
}

/** Edits holidays and rotations as lists of rows. */
export function CalendarEditor({ draft, setDraft, errors }: EditorProps<'calendar'>) {
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

/** Shows the thresholds. */
export function ThresholdsView({ value }: ViewProps<'thresholds'>) {
  return (
    <dl class="settings-list">
      <dt>Long-term MC</dt>
      <dd>{value.longMcDays} days or longer</dd>
      <dt>Leaderboard size</dt>
      <dd>Top {value.leaderboardSize}</dd>
    </dl>
  );
}

/** Edits the thresholds. */
export function ThresholdsEditor({ draft, setDraft, errors }: EditorProps<'thresholds'>) {
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

/** Shows the session settings. */
export function SessionView({ value }: ViewProps<'session'>) {
  return (
    <dl class="settings-list">
      <dt>Login lasts</dt>
      <dd>{value.ttlHours} hours (applies from the next login)</dd>
      <dt>Refresh every</dt>
      <dd>{value.refreshSeconds} seconds</dd>
    </dl>
  );
}

/** Edits the session settings. */
export function SessionEditor({ draft, setDraft, errors }: EditorProps<'session'>) {
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
