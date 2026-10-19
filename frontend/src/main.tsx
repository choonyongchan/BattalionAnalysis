/** Entry point: stylesheets in cascade order (tokens first, everything else reads them), then mount. */

import { render } from 'preact';
import './theme/tokens.css';
import './theme/base.css';
import './theme/controls.css';
import './theme/shell.css';
import './theme/components/cards.css';
import './theme/components/table.css';
import './theme/components/deposit.css';
import './theme/components/soldier-search.css';
import './theme/components/filing.css';
import './theme/components/duty-roster.css';
import { Router } from './app/Router.tsx';
import { resume } from './app/auth.ts';
import { startTelemetry } from './app/telemetry.ts';
import * as state from './app/state.ts';

// Development only, removed from the production bundle: push a fixture into the store without the password.
if (import.meta.env.DEV) {
  window.__dashboard = state;
}

startTelemetry();
render(<Router />, document.getElementById('app')!);
void resume();
