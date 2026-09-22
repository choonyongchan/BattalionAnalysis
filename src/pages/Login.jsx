/**
 * The screen in front of everything else.
 *
 * One headline and one field. There is no explanation above the field because there is
 * nothing to decide — a commander either has the password or does not — so the note about
 * where the check happens sits at the foot, out of the way of the one thing to do.
 *
 * The field is cleared as soon as its value is captured. A typed password left sitting in
 * an input is one screenshot or one shoulder away from being shared.
 *
 * The wait after the field is submitted is usually a second or two, but a cold start
 * wakes both the Vercel function and the Neon database, so the loading state is still
 * given a shape rather than a frozen button.
 */

import { useRef, useState } from 'preact/hooks';
import { Logo } from '../app/Logo.jsx';
import { unlock } from '../app/auth.js';
import { loadError, status } from '../app/state.js';
import { LoadingProgress } from '../components/LoadingProgress.jsx';

/** @type {number} The wait the bar is paced against, in seconds. */
const EXPECTED_SECONDS = 5;

/**
 * What the screen says while it waits, and from which second.
 *
 * These are descriptions of the one request in flight, timed to how it usually unfolds —
 * not observations of where the server has got to, which nothing on this side can see.
 * @type {!Array<{at: number, label: string}>}
 */
const STAGES = [
  { at: 0, label: 'Sending the password' },
  { at: 1, label: 'Reading parade states and report-sick submissions' },
  { at: 4, label: 'Waking the database' },
  { at: 12, label: 'Nothing has gone wrong — the database is just slow to wake' },
];

/**
 * Renders the login screen.
 * @returns {!preact.VNode} The screen.
 */
export function Login() {
  const inputRef = useRef(null);
  const [typed, setTyped] = useState('');
  const busy = status.value === 'loading';

  /**
   * Sends the typed password and clears the field either way.
   * @param {!Event} event The submit event.
   * @returns {void}
   */
  function onSubmit(event) {
    event.preventDefault();
    const value = typed;
    setTyped('');
    unlock(value).then((ok) => {
      if (!ok && inputRef.current) {
        inputRef.current.focus();
      }
    });
  }

  return (
    <main class="login">
      <div class="login__panel">
        <p class="login__brand">
          <Logo size={88} />
        </p>

        <h1 class="login__title">Good day, Commander</h1>

        <form class="login__form" onSubmit={onSubmit}>
          <label class="visually-hidden" for="password">
            Dashboard password
          </label>
          <input
            class="login__input"
            id="password"
            ref={inputRef}
            type="password"
            name="password"
            autocomplete="current-password"
            spellcheck={false}
            placeholder="Password"
            value={typed}
            disabled={busy}
            onInput={(event) => setTyped(event.currentTarget.value)}
          />
          <button class="button button--primary" type="submit" disabled={busy}>
            {busy ? 'Opening' : 'Enter'}
          </button>
        </form>

        {busy ? (
          <LoadingProgress
            stages={STAGES}
            expectedSeconds={EXPECTED_SECONDS}
            label="Opening the dashboard"
          />
        ) : null}

        {loadError.value ? (
          <p class="login__error" role="alert">
            {loadError.value}
          </p>
        ) : null}

        <p class="login__note">
          {busy
            ? 'The first read after a quiet spell wakes the database. Leave this page ' +
              'open — it will open by itself.'
            : 'The data stays private. The password is checked on the server that holds ' +
              'it, so a wrong one returns no rows at all.'}
        </p>
      </div>
    </main>
  );
}
