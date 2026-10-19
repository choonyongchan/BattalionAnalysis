/**
 * One settings section as a card: what it is set to, and, for an editor, a form to change it.
 *
 * The form checks the draft with the same validator the server runs, so a mistake is shown
 * beside its field before anything is sent. A save names the version the form opened on;
 * if someone else saved in between, the server refuses and the card says so rather than
 * overwriting their change. After a save or reset the dashboard re-reads, which is how every
 * page picks up the new value.
 */

import type { ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import { refresh } from '../../app/auth.ts';
import { canEdit } from '../../app/state.ts';
import { Banner, Card } from '../../components/Card.tsx';
import { resetSection, saveSection } from '../../data/settings.ts';
import { validateSection, type FieldMessage } from '../../../../shared/settings/validate.ts';
import type { SectionName, SettingsValues } from '../../../../shared/settings/defaults.ts';
import type { SectionMeta } from '../../../../shared/settings/resolve.ts';
import { ApiError } from '../../data/api.ts';
import type { Draft, EditorProps, ViewProps } from './editors.tsx';

/** A section card. */
export function SectionCard<S extends SectionName>({
  section,
  title,
  value,
  meta,
  View,
  Editor,
}: {
  section: S;
  title: string;
  value: SettingsValues[S];
  meta: SectionMeta | undefined;
  View: ComponentType<ViewProps<S>>;
  Editor: ComponentType<EditorProps<S>>;
}) {
  const [draft, setDraft] = useState<Draft<S> | null>(null);
  const [errors, setErrors] = useState<FieldMessage[]>([]);
  const [warnings, setWarnings] = useState<FieldMessage[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const version = meta?.version ?? 0;
  const note = meta?.invalid ? 'Stored value invalid, showing defaults' : meta?.isDefault ? 'Default' : '';

  /** Opens the form on a copy of the value in force. */
  function edit() {
    setDraft(structuredClone(value) as Draft<S>);
    setErrors([]);
    setWarnings([]);
    setMessage('');
  }

  /** Runs a write, then re-reads the dashboard; shows a refusal on the card. */
  async function run(write: () => Promise<{ warnings?: FieldMessage[] } | void>) {
    setBusy(true);
    setMessage('');
    try {
      const result = await write();
      setWarnings(result?.warnings ?? []);
      setDraft(null);
      await refresh();
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : []);
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  /** Validates the draft locally, then saves it. */
  function onSave(event: Event) {
    event.preventDefault();
    const checked = validateSection(section, draft);
    setErrors(checked.errors);
    setWarnings(checked.warnings);
    if (checked.errors.length > 0) {
      setMessage('Some fields need fixing.');
      return;
    }
    void run(() => saveSection(section, checked.value, version));
  }

  return (
    <Card title={title} note={note}>
      {meta?.invalid ? (
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
