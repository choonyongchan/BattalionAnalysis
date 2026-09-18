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
 * The wait after the field is submitted is long — the feed wakes an Apps Script
 * deployment and reads every tab through it — so the screen spends most of its life in
 * the loading state, and that state is given as much care as the field.
 */

import { useRef, useState } from 'preact/hooks';
import { Logo } from '../app/Logo.jsx';
import { unlock } from '../app/auth.js';
import { loadError, status } from '../app/state.js';
import { LoadingProgress } from '../components/LoadingProgress.jsx';

/** @type {number} The wait the bar is paced against, in seconds. */
const EXPECTED_SECONDS = 30;

/**
 * What the screen says while it waits, and from which second.
 *
 * These are descriptions of the one request in flight, timed to how it usually unfolds —
 * not observations of where the server has got to, which nothing on this side can see.
 * @type {!Array<{at: number, label: string}>}
 */
const STAGES = [
  { at: 0, label: 'Sending the password' },
  { at: 3, label: 'Waking the spreadsheet feed' },
  { at: 10, label: 'Reading the spreadsheet' },
  { at: 20, label: 'Still reading the rows' },
  { at: 32, label: 'Nothing has gone wrong — the spreadsheet is just slow today' },
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
            ? 'The first read wakes the spreadsheet, which is the slow part. Leave this ' +
              'page open — it will open by itself.'
            : 'The spreadsheet stays private. The password is checked on the server that ' +
              'holds the data, so a wrong one returns no rows at all.'}
        </p>
      </div>
    </main>
  );
}
