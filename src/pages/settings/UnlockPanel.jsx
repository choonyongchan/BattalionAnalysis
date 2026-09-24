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
