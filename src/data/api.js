/**
 * The one way the Deposit page calls a write route (`/api/parade`, `/api/sft`).
 *
 * Same-origin, like `/api/dashboard`, so the session cookie `api/session.ts` issued goes
 * with every call and nothing here handles a credential. `credentials: 'same-origin'` is
 * the fetch default, and is written out because it is the thing that makes these calls
 * work at all.
 */

/**
 * Calls a route and reads its JSON answer.
 *
 * A 422 is not thrown: it is the route saying what to correct, which the page shows.
 * @param {string} url The route, e.g. '/api/parade'.
 * @param {string} method The HTTP method.
 * @param {string} query The query string, e.g. '?id=4', or ''.
 * @param {!Object|undefined} body The JSON body, if any.
 * @param {!Object<number, string>} httpErrors What each non-JSON failure means to the person
 *     at the screen.
 * @returns {!Promise<!Object>} The parsed answer.
 * @throws {Error} With a readable message, for anything but a 2xx or 422.
 */
export async function callJson(url, method, query, body, httpErrors) {
  let response;
  try {
    response = await fetch(url + query, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check the connection and try again.');
  }
  const answer = await response.json().catch(() => ({}));
  if (response.ok || response.status === 422) return answer;
  throw new Error(httpErrors[response.status] || answer.error || `The server answered ${response.status}.`);
}
