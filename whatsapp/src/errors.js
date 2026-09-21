/**
 * Turns a caught error into a summary that is safe to log.
 *
 * drizzle-orm's `DrizzleQueryError` formats its `message` as
 * `Failed query: <sql>\nparams: <params>` (see node_modules/drizzle-orm/errors.js), and
 * `params` is the query's bound values. For `recordMessage` that is the parade-state
 * body; for `markFailed` it is the rejection reason, which can quote the message. Either
 * way `err.message` (and `err.params`) can carry a name or an NRIC, so neither may reach
 * the log.
 *
 * The error's `cause` is safe: drizzle's pg-core session (see
 * node_modules/drizzle-orm/pg-core/session.js) sets it to the raw driver error it caught,
 * before wrapping it, so it never carries the query or its params -- only whatever the
 * driver itself put on the error, such as a `code`.
 */

/**
 * Whether `err` has the shape drizzle-orm's `DrizzleQueryError` has: a `query` string
 * and a `params` field alongside the inherited `message`.
 *
 * Checked by shape rather than `instanceof` or `err.name`: `DrizzleQueryError` never sets
 * `this.name`, so every instance reports the inherited `"Error"`, and shape-checking also
 * lets a test build an equivalent object without importing the real class.
 *
 * @param {*} err Whatever a catch block received.
 * @returns {boolean} True if `err` looks like a `DrizzleQueryError`.
 */
function isDrizzleQueryError(err) {
  return Boolean(err) && typeof err === 'object' && typeof err.query === 'string' && 'params' in err;
}

/**
 * Summarises an error for logging, without ever including a `DrizzleQueryError`'s own
 * `message` or `params`.
 *
 * @param {*} err Whatever a catch block received.
 * @returns {{name: string, message: (string|undefined), causeCode: (string|undefined),
 *   causeMessage: (string|undefined)}} A safe summary. `message` is present only for a
 *   non-`DrizzleQueryError`; `causeCode`/`causeMessage` are present only when the error's
 *   `cause` carries them.
 */
export function describeError(err) {
  if (!err || typeof err !== 'object') return { name: String(err) };

  if (isDrizzleQueryError(err)) {
    const summary = { name: err.name || 'Error' };
    if (err.cause?.code !== undefined) summary.causeCode = err.cause.code;
    if (err.cause?.message !== undefined) summary.causeMessage = err.cause.message;
    return summary;
  }

  return { name: err.name, message: err.message };
}
