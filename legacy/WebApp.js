/**
 * The project's single web-app entry point, dispatching to one intake per route.
 *
 * Apps Script allows exactly one `doPost` per project, but three callers now need
 * it: the FormSG report-sick relay from Plumber, the WhatsApp parade-state
 * bridge, and the dashboard. So the route is named explicitly in the query string:
 *
 *     .../exec?route=reportsick    -> FormSgSheet.handlePost   (Plumber)
 *     .../exec?route=paradestate   -> Parser.handlePost        (bridge)
 *     .../exec?route=dashboard     -> DashboardFeed.handlePost (dashboard)
 *
 * The first two write; the third only reads. It is routed through the same entry
 * point because a project gets one `doPost`, not because it shares anything else
 * with them — see docs/architecture_patterns.md.
 *
 * This is the one file that knows about all three. Everywhere else they stay
 * strictly independent.
 *
 * An unrouted or unknown request is rejected rather than defaulted to either
 * intake. Guessing would be worse than failing: a body meant for one handler
 * silently accepted by the other writes wrong rows to the wrong tab.
 *
 * Note that changes to this file only take effect after redeploying the web app
 * — a `clasp push` alone is not enough. See README.md.
 *
 * For the same reason it hosts `doPost`, this file also hosts the project's one
 * `onEditHandler` global: `ScriptApp.newTrigger` needs a single top-level function
 * name, but the parade-state pipeline (`Parser.onEditHandler`) and the FormSG
 * CSV-import repair (`FormSgTimestamps.onEditHandler`) both need to run off it.
 */

/**
 * Route values accepted in the `route` query parameter.
 * @type {{PARADE_STATE: string, REPORT_SICK: string, DASHBOARD: string}}
 */
const WEB_APP_ROUTES = {
  PARADE_STATE: 'paradestate',
  REPORT_SICK: 'reportsick',
  DASHBOARD: 'dashboard',
};

/**
 * Receives every POST to the deployed web app and dispatches it by route.
 *
 * The deployment must allow anonymous access, because none of the three callers
 * can authenticate to Google — Plumber and the bridge have no Google identity,
 * and the dashboard is a static page with no credential to offer. So each route
 * carries its own shared-secret check against its own script property —
 * `Parser.isAuthorised_`, `FormSgSheet.isAuthorised_` and
 * `DashboardFeed.isAuthorised_` — kept separate so any one secret can be rotated
 * alone. All three fail closed when their property is unset. A shared secret is
 * the ceiling of what is possible here: Apps Script cannot read request headers.
 * See DeveloperGuide.md §8.4.
 *
 * @param {!Object} e The Apps Script doPost event object.
 * @returns {!GoogleAppsScript.Content.TextOutput} A JSON response body.
 */
function doPost(e) {
  const route = (e && e.parameter && e.parameter.route) || '';

  if (route === WEB_APP_ROUTES.PARADE_STATE) {
    return Parser.handlePost(e);
  }
  if (route === WEB_APP_ROUTES.REPORT_SICK) {
    return FormSgSheet.handlePost(e);
  }
  if (route === WEB_APP_ROUTES.DASHBOARD) {
    return DashboardFeed.handlePost(e);
  }

  // Named explicitly because this is the one misconfiguration that fails
  // invisibly. ContentService cannot set a status code, so the caller is
  // answered 200, records the delivery as a success, and never retries —
  // rows simply stop arriving with nothing anywhere to say why. If
  // report-sick rows have stopped, the cause is almost certainly a Plumber
  // URL still missing "?route=reportsick".
  Logger.log(
    `WebApp: rejected a POST with route "${route}". Expected ` +
      `"?route=${WEB_APP_ROUTES.REPORT_SICK}" (Plumber), ` +
      `"?route=${WEB_APP_ROUTES.PARADE_STATE}" (WhatsApp bridge) or ` +
      `"?route=${WEB_APP_ROUTES.DASHBOARD}" (dashboard). ` +
      'Check the URL configured in the caller. See README.md.'
  );
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unknown_route' })).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * Installable onEdit trigger, shared by every module that needs one.
 *
 * Apps Script fires this for edits anywhere in the bound spreadsheet, so each
 * handler is responsible for filtering to the sheet and columns it cares about —
 * see `Parser.onEditHandler` and `FormSgTimestamps.onEditHandler`. Installed by
 * `Parser.installTriggers()` under this function's name.
 * @param {!GoogleAppsScript.Events.SheetsOnEdit} e The edit event.
 * @returns {void}
 */
function onEditHandler(e) {
  Parser.onEditHandler(e);
  FormSgTimestamps.onEditHandler(e);
}
