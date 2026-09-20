/**
 * Global entry points for the FormSG module.
 *
 * Apps Script only invokes top-level function names — it cannot call a class static
 * method directly, and the editor's function dropdown only lists globals. Each
 * function here immediately delegates to the matching FormSg* static method.
 *
 * The web-app entry point is no longer here. A project gets one `doPost`, and a
 * second intake (the WhatsApp parade-state bridge) now shares it, so `src/WebApp.js`
 * owns the global and dispatches `?route=reportsick` to FormSgSheet.handlePost.
 * Plumber's URL must carry that parameter.
 *
 * `FormSgTimestamps.onEditHandler` has no wrapper here — it runs off the same
 * installable `onEdit` trigger as the parade-state pipeline, dispatched from the
 * shared `onEditHandler` global in `src/WebApp.js`.
 */

/**
 * Checks that the responses tab exists and its header matches FORMSG_COLUMNS.
 * @returns {void}
 */
function formSgVerifySetup() {
  FormSgSchema.verify();
}
