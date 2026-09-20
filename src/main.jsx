/**
 * Entry point: load the stylesheets in cascade order, then mount.
 *
 * The order matters. `tokens.css` declares the custom properties everything else reads;
 * `base.css` sets the type ladder on top of them; the rest use both. Importing them here
 * rather than linking them from the HTML keeps that order a fact about this file instead
 * of a convention someone has to remember.
 */

import { render } from 'preact';
import './theme/tokens.css';
import './theme/base.css';
import './theme/controls.css';
import './theme/shell.css';
import './theme/components.css';
import { Router } from './app/Router.jsx';
import * as state from './app/state.js';

/*
 * A handle on the store, in development only.
 *
 * Every page sits behind a password that is checked on a server, so there is no way to
 * open one locally without the real credential — which makes layout and theme work
 * unreviewable, for a person and for a design review alike. This lets a fixture be pushed
 * straight into the store instead. `import.meta.env.DEV` is a compile-time constant, so
 * the whole block is removed from the production bundle rather than merely skipped.
 */
if (import.meta.env.DEV) {
  window.__dashboard = state;
}

render(<Router />, document.getElementById('app'));
