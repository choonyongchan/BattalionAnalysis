/**
 * The pieces both Deposit panels (parade states and SFT) are built from.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import { dataset } from '../../app/state.ts';
import type { OutcomeNote } from '../../model/paradeMessages.ts';

/** What the server said about the last save or delete. */
export function Outcome({ result }: { result: OutcomeNote | null }) {
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
 * The Edit / Delete controls for one row. Delete asks once more inline rather than through a browser dialog.
 */
export function RowActions({
  label,
  confirming,
  busy,
  onEdit,
  onDelete,
  onConfirm,
  onKeep,
}: {
  label: string;
  confirming: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirm: () => void;
  onKeep: () => void;
}) {
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

/** Runs one server call with the panel marked busy, showing a thrown error as the outcome. */
export async function runBusy(
  setBusy: (busy: boolean) => void,
  setResult: (result: OutcomeNote) => void,
  action: () => Promise<void>,
): Promise<void> {
  setBusy(true);
  try {
    await action();
  } catch (error) {
    setResult({ tone: 'error', text: error instanceof Error ? error.message : String(error), reasons: [] });
  } finally {
    setBusy(false);
  }
}

/** A stored list (null while loading), re-read on every background refresh; `reload` reads it now. */
export function useStoredList<T>(load: () => Promise<T[]>): { items: T[] | null; error: string; reload: () => Promise<void> } {
  const [items, setItems] = useState<T[] | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(
    () =>
      load()
        .then((list) => {
          setItems(list);
          setError('');
        })
        .catch((failure: Error) => setError(failure.message)),
    [],
  );
  const refreshedAt = dataset.value?.generatedAt;
  useEffect(() => {
    void reload();
  }, [reload, refreshedAt]);
  return { items, error, reload };
}
