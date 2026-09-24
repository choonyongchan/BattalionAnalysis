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
