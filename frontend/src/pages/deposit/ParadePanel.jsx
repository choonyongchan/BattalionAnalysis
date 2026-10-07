/**
 * Deposit → Parade State: deposit a parade state WhatsApp missed, and correct or delete any
 * already stored.
 *
 * It talks to `/api/parade` on Vercel, which parses with the same rule-based parser the
 * WhatsApp relay's messages go through, so a deposited parade state is indistinguishable from
 * a relayed one except for its source. The charts read the same tables through
 * `/api/dashboard`; a change here refreshes them at once, and the list below reloads with
 * every background refresh so a message the relay stores meanwhile appears.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { refresh } from '../../app/auth.js';
import { dataset } from '../../app/state.js';
import { Banner, Card, EmptyState } from '../../components/Card.jsx';
import { DataTable } from '../../components/Table.jsx';
import { deleteMessage, depositMessage, editMessage, getMessage, listMessages } from '../../data/parade.js';
import { fmtDate, fmtInt } from '../../format.js';
import { MESSAGE_STATUS, describeOutcome, toMessageRows } from '../../model/paradeMessages.js';
import { settingOf } from '../../model/activeSettings.js';
import { Outcome, RowActions, runBusy } from './shared.jsx';

/** @type {!Object<string, string>} The status class suffix for each status. */
const STATUS_CLASS = {
  [MESSAGE_STATUS.PARSED]: 'good',
  [MESSAGE_STATUS.NEEDS_REVIEW]: 'critical',
  [MESSAGE_STATUS.REJECTED]: 'muted',
  [MESSAGE_STATUS.PENDING]: 'warning',
};

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
          placeholder={settingOf('unit').name.toUpperCase() + ' ARCHER COMPANY\nFIRST PARADE STATE\nDATE: DDMMYY TIME: HHMM\n…'}
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
 * The parade-state panel.
 * @returns {!preact.VNode} The deposit form and the stored messages.
 */
export function ParadePanel() {
  const [messages, setMessages] = useState(null);
  const [listError, setListError] = useState('');
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const formRef = useRef(null);

  const reload = useCallback(() => {
    return listMessages()
      .then((list) => {
        setMessages(list);
        setListError('');
      })
      .catch((error) => setListError(error.message));
  }, []);

  // `dataset` changes on every background refresh; the list follows it.
  const refreshedAt = dataset.value && dataset.value.generatedAt;
  useEffect(() => {
    reload();
  }, [reload, refreshedAt]);

  const run = (action) => runBusy(setBusy, setResult, action);

  const resetForm = () => {
    setEditing(null);
    setText('');
  };

  const submit = () =>
    run(async () => {
      const outcome = editing ? await editMessage(editing, text) : await depositMessage(text);
      const said = describeOutcome(outcome);
      setResult(said);
      if (said.tone === 'good') resetForm();
      await reload();
      refresh();
    });

  const startEdit = (id) =>
    run(async () => {
      const message = await getMessage(id);
      setEditing(id);
      setText(message.body);
      setResult(null);
      setConfirming(null);
      if (formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

  const confirmDelete = (id) =>
    run(async () => {
      await deleteMessage(id);
      setConfirming(null);
      if (editing === id) resetForm();
      setResult({ tone: 'good', text: `Deleted #${id} and everything parsed from it.`, reasons: [] });
      await reload();
      refresh();
    });

  const rows = toMessageRows(messages || []).map((row) => ({
    ...row,
    idLabel: '#' + row.id,
    receivedLabel: row.received ? fmtDate(row.received.date) + ', ' + row.received.time : '—',
    statusCell: <StatusCell status={row.status} reasons={row.reasons} />,
    actions: (
      <RowActions
        label={'#' + row.id}
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
    <>
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
    </>
  );
}
