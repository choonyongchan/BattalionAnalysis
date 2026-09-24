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
