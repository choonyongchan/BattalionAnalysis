/**
 * Parade States: deposit one WhatsApp missed, and correct or delete any already stored.
 *
 * The one page that writes. It talks to `/api/parade` on Vercel, which parses with the same
 * rule-based parser the WhatsApp relay's messages go through, so a deposited parade state is
 * indistinguishable from a relayed one except for its source. The charts read the same
 * tables through `/api/dashboard`, so a deposit reaches them on the next refresh.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { authHeader } from '../app/auth.js';
import { Banner, Card, EmptyState } from '../components/Card.jsx';
import { DataTable } from '../components/Table.jsx';
import { deleteMessage, depositMessage, editMessage, getMessage, listMessages } from '../data/parade.js';
import { fmtDate, fmtInt } from '../format.js';
import { MESSAGE_STATUS, describeOutcome, toMessageRows } from '../model/paradeMessages.js';

/** @type {!Object<string, string>} The status class suffix for each status. */
const STATUS_CLASS = {
  [MESSAGE_STATUS.PARSED]: 'good',
  [MESSAGE_STATUS.NEEDS_REVIEW]: 'critical',
  [MESSAGE_STATUS.REJECTED]: 'muted',
  [MESSAGE_STATUS.PENDING]: 'warning',
};

/**
 * What the intake said about the last deposit or edit.
 * @param {{result: ?{tone: string, text: string, reasons: !Array<string>}}} props The message.
 * @returns {?preact.VNode} The banner, or nothing before the first submit.
 */
function Outcome({ result }) {
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
 * The deposit form, which doubles as the editor for a stored message.
 * @param {{text: string, onText: function(string), editing: ?number, busy: boolean,
 *     result: ?Object, onSubmit: function(), onCancel: function(), formRef: !Object}} props
 *     The form's state and handlers.
 * @returns {!preact.VNode} The card.
 */
function DepositForm({ text, onText, editing, busy, result, onSubmit, onCancel, formRef }) {
  return (
    <Card
      title={editing ? `Editing #${editing}` : 'Deposit a parade state'}
      note={editing ? 'Saving re-parses it and replaces everything parsed from it.' : 'For a parade state WhatsApp missed.'}
    >
      <form
        ref={formRef}
        class="deposit"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label class="field__label" for="deposit-text">
          Paste the parade state exactly as it was sent
        </label>
        <textarea
          id="deposit-text"
          class="field field--area"
          rows={16}
          spellcheck={false}
          value={text}
          onInput={(event) => onText(event.currentTarget.value)}
          placeholder={'40 SAR ARCHER COMPANY\nFIRST PARADE STATE\nDATE: DDMMYY TIME: HHMM\n…'}
        />
        <Outcome result={result} />
        <div class="deposit__actions">
          <button class="button button--primary" type="submit" disabled={busy || text.trim() === ''}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Deposit'}
          </button>
          {editing ? (
            <button class="button button--quiet" type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

/**
 * The Edit / Delete controls for one row. Delete asks once more inline rather than through
 * a browser dialog.
 * @param {{id: number, confirming: boolean, busy: boolean, onEdit: function(),
 *     onDelete: function(), onConfirm: function(), onKeep: function()}} props The row's state.
 * @returns {!preact.VNode} The controls.
 */
function RowActions({ id, confirming, busy, onEdit, onDelete, onConfirm, onKeep }) {
  if (confirming) {
    return (
      <span class="rowactions">
        <button class="button button--quiet button--danger" type="button" onClick={onConfirm} disabled={busy}>
          Delete #{id}
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
 * The status cell: the label, and beneath it what stopped the message parsing.
 * @param {{status: string, reasons: !Array<string>}} props The row's status and reasons.
 * @returns {!preact.VNode} The cell content.
 */
function StatusCell({ status, reasons }) {
  return (
    <span class="msgstatus">
      <span class={'msgstatus__label msgstatus__label--' + STATUS_CLASS[status]}>{status}</span>
      {reasons.length ? <span class="msgstatus__reason">{reasons.join(' · ')}</span> : null}
    </span>
  );
}

/**
 * The Parade States page.
 * @returns {!preact.VNode} The page.
 */
export function ParadeStates() {
  const [messages, setMessages] = useState(null);
  const [listError, setListError] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const formRef = useRef(null);

  const reload = useCallback(() => {
    return listMessages(authHeader())
      .then((list) => {
        setMessages(list);
        setListError('');
      })
      .catch((error) => setListError(error.message));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Runs one intake call with the page marked busy, showing a thrown error as the outcome. */
  const run = async (action) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setResult({ tone: 'error', text: error.message, reasons: [] });
    } finally {
      setBusy(false);
    }
  };

  const resetForm = () => {
    setEditing(null);
    setText('');
  };

  const submit = () =>
    run(async () => {
      const outcome = editing ? await editMessage(authHeader(), editing, text) : await depositMessage(authHeader(), text);
      const said = describeOutcome(outcome);
      setResult(said);
      if (said.tone === 'good') resetForm();
      await reload();
    });

  const startEdit = (id) =>
    run(async () => {
      const message = await getMessage(authHeader(), id);
      setEditing(id);
      setText(message.body);
      setResult(null);
      setConfirming(null);
      if (formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

  const confirmDelete = (id) =>
    run(async () => {
      await deleteMessage(authHeader(), id);
      setConfirming(null);
      if (editing === id) resetForm();
      setResult({ tone: 'good', text: `Deleted #${id} and everything parsed from it.`, reasons: [] });
      await reload();
    });

  const rows = toMessageRows(messages || []).map((row) => ({
    ...row,
    idLabel: '#' + row.id,
    receivedLabel: row.received ? fmtDate(row.received.date) + ', ' + row.received.time : '—',
    statusCell: <StatusCell status={row.status} reasons={row.reasons} />,
    actions: (
      <RowActions
        id={row.id}
        confirming={confirming === row.id}
        busy={busy}
        onEdit={() => startEdit(row.id)}
        onDelete={() => setConfirming(row.id)}
        onConfirm={() => confirmDelete(row.id)}
        onKeep={() => setConfirming(null)}
      />
    ),
  }));

  return (
    <div class="page">
      <header class="pagehead">
        <div>
          <h1 class="pagehead__title">Parade States</h1>
          <p class="pagehead__sub">Deposit a parade state WhatsApp missed, or correct one already stored.</p>
        </div>
      </header>

      <DepositForm
        text={text}
        onText={setText}
        editing={editing}
        busy={busy}
        result={result}
        onSubmit={submit}
        onCancel={() => {
          resetForm();
          setResult(null);
        }}
        formRef={formRef}
      />

      <Card title="Stored parade states" note={messages ? fmtInt(messages.length) + ' stored' : ''}>
        {listError ? <Banner tone="error">{listError}</Banner> : null}
        {messages === null && !listError ? <EmptyState>Loading…</EmptyState> : null}
        {messages && messages.length === 0 ? <EmptyState>Nothing stored yet.</EmptyState> : null}
        {messages && messages.length > 0 ? (
          <DataTable
            columns={[
              { key: 'idLabel', label: 'ID' },
              { key: 'parade', label: 'Parade' },
              { key: 'statusCell', label: 'Status' },
              { key: 'source', label: 'Source' },
              { key: 'receivedLabel', label: 'Received' },
              { key: 'actions', label: '' },
            ]}
            rows={rows}
            rowKey={(row) => row.id}
          />
        ) : null}
      </Card>
    </div>
  );
}
