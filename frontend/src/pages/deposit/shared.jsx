/**
 * The pieces both Deposit panels (parade states and SFT) are built from.
 */

/**
 * What the server said about the last save or delete.
 * @param {{result: ?{tone: string, text: string, reasons: !Array<string>}}} props The message.
 * @returns {?preact.VNode} The banner, or nothing before the first submit.
 */
export function Outcome({ result }) {
  if (!result) return null;
  return (
    <div class={'banner banner--' + result.tone} role="status">
      <p>{result.text}</p>
      {result.reasons.length ? (
        <ul class="outcome__reasons">
          {result.reasons.map((reason, index) => (
            <li key={index}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The Edit / Delete controls for one row. Delete asks once more inline rather than through
 * a browser dialog.
 * @param {{label: string, confirming: boolean, busy: boolean, onEdit: function(),
 *     onDelete: function(), onConfirm: function(), onKeep: function()}} props The row's
 *     name on the confirm button, and its state.
 * @returns {!preact.VNode} The controls.
 */
export function RowActions({ label, confirming, busy, onEdit, onDelete, onConfirm, onKeep }) {
  if (confirming) {
    return (
      <span class="rowactions">
        <button class="button button--quiet button--danger" type="button" onClick={onConfirm} disabled={busy}>
          Delete {label}
        </button>
        <button class="button button--quiet" type="button" onClick={onKeep} disabled={busy}>
          Keep
        </button>
      </span>
    );
  }
  return (
    <span class="rowactions">
      <button class="button button--quiet" type="button" onClick={onEdit} disabled={busy}>
        Edit
      </button>
      <button class="button button--quiet" type="button" onClick={onDelete} disabled={busy}>
        Delete
      </button>
    </span>
  );
}

/**
 * Runs one server call with the panel marked busy, showing a thrown error as the outcome.
 * @param {function(boolean): void} setBusy Marks the panel busy.
 * @param {function(!Object): void} setResult Shows the outcome.
 * @param {function(): !Promise} action The call.
 * @returns {!Promise<void>} Resolves when the call is over.
 */
export async function runBusy(setBusy, setResult, action) {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    setResult({ tone: 'error', text: error.message, reasons: [] });
  } finally {
    setBusy(false);
  }
}
