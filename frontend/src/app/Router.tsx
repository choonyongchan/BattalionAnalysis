/**
 * The login screen until data is loaded, then the shell with the page the hash names. Hash routing,
 * because the static host has no rewrite for deep links (`/soldier` would 404 on a refresh).
 */

import { Redirect, Route, Router as WouterRouter, Switch } from 'wouter-preact';
import { useHashLocation } from 'wouter-preact/use-hash-location';
import { Shell } from './Shell.tsx';
import { DEFAULT_ROUTE, ROUTES, ROUTE_ALIASES } from './routes.ts';
import { isReady } from './state.ts';
import { Login } from '../pages/Login.tsx';

/** Renders the login screen, or the shell with the page the hash names. */
export function Router() {
  if (!isReady.value) {
    return <Login />;
  }

  return (
    <WouterRouter hook={useHashLocation}>
      <Shell>
        <Switch>
          {ROUTES.map(({ path, component: Page }) => (
            <Route key={path} path={path}>
              <Page />
            </Route>
          ))}
          {Object.entries(ROUTE_ALIASES).map(([from, to]) => (
            <Route key={from} path={from}>
              <Redirect to={to} replace />
            </Route>
          ))}
          <Route>
            <Redirect to={DEFAULT_ROUTE} replace />
          </Route>
        </Switch>
      </Shell>
    </WouterRouter>
  );
}
