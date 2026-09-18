/**
 * What the browser shows, given the hash and whether the dashboard is unlocked.
 *
 * Hash routing rather than history routing, because the dashboard is served from a
 * GitHub Pages sub-path with no server to rewrite deep links — `/soldier` would 404 on a
 * refresh, `#/soldier` cannot.
 *
 * The login screen is not a route. It stands in front of every route until data is
 * loaded, so there is no URL that shows a page frame with no data behind it.
 */

import { Redirect, Route, Router as WouterRouter, Switch } from 'wouter-preact';
import { useHashLocation } from 'wouter-preact/use-hash-location';
import { Shell } from './Shell.jsx';
import { DEFAULT_ROUTE } from './routes.js';
import { isReady } from './state.js';
import { Login } from '../pages/Login.jsx';
import { Overview } from '../pages/Overview.jsx';
import { ReportSick } from '../pages/ReportSick.jsx';
import { McMa } from '../pages/McMa.jsx';
import { Status } from '../pages/Status.jsx';
import { Soldier } from '../pages/Soldier.jsx';
import { Orbat } from '../pages/Orbat.jsx';
import { Settings } from '../pages/Settings.jsx';

/**
 * Renders the login screen, or the shell with the page the hash names.
 * @returns {!preact.VNode} The application.
 */
export function Router() {
  if (!isReady.value) {
    return <Login />;
  }

  return (
    <WouterRouter hook={useHashLocation}>
      <Shell>
        <Switch>
          <Route path="/overview" component={Overview} />
          <Route path="/report-sick" component={ReportSick} />
          <Route path="/mc-ma" component={McMa} />
          <Route path="/status" component={Status} />
          <Route path="/soldier" component={Soldier} />
          <Route path="/orbat" component={Orbat} />
          <Route path="/settings" component={Settings} />
          <Route>
            <Redirect to={DEFAULT_ROUTE} replace />
          </Route>
        </Switch>
      </Shell>
    </WouterRouter>
  );
}
