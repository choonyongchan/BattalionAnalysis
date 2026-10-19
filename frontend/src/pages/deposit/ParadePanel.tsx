/**
 * Deposit → Parade State: deposit a parade state WhatsApp missed, or correct or delete a stored one, through
 * `/api/parade` (the same parser the relay uses).
 */

import type { RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { refresh } from '../../app/auth.ts';
import { Banner, Card, EmptyState } from '../../components/Card.tsx';
import { DataTable } from '../../components/Table.tsx';
import { deleteMessage, depositMessage, editMessage, getMessage, listMessages } from '../../data/parade.ts';
import { fmtDate, fmtInt } from '../../format.ts';
import { MESSAGE_STATUS, describeOutcome, toMessageRows, type MessageStatus, type OutcomeNote } from '../../model/paradeMessages.ts';
import { reasonsOf } from '../../../../shared/paradeMessage.ts';
import { settingOf } from '../../model/activeSettings.ts';
import { Outcome, RowActions, runBusy, useStoredList } from './shared.tsx';

/** The status class suffix for each status. */
const STATUS_CLASS: Record<MessageStatus, string> = {
  [MESSAGE_STATUS.PARSED]: 'good',
  [MESSAGE_STATUS.NEEDS_REVIEW]: 'critical',
  [MESSAGE_STATUS.REJECTED]: 'muted',
  [MESSAGE_STATUS.PENDING]: 'warning',
};

/** The deposit form, which doubles as the editor for a stored message. */
function DepositForm({
  text,
  onText,
  editing,
  busy,
  result,
  onSubmit,
  onCancel,
  formRef,
}: {
  text: string;
  onText: (text: string) => void;
  /** The id of the message being edited, or null for a new deposit. */
  editing: number | null;
  busy: boolean;
  result: OutcomeNote | null;
  onSubmit: () => void;
  onCancel: () => void;
  formRef: RefObject<HTMLFormElement>;
}) {
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
 * The status cell: the label, and beneath it how many lines stopped the message parsing. The lines themselves
 * show only once the message is opened for editing.
 */
function StatusCell({ status, problems }: { status: MessageStatus; problems: number }) {
  return (
    <span class="msgstatus">
      <span class={'msgstatus__label msgstatus__label--' + STATUS_CLASS[status]}>{status}</span>
      {problems ? (
        <span class="msgstatus__reason">
          {problems} line{problems === 1 ? '' : 's'} to fix. Edit to see {problems === 1 ? 'it' : 'them'}.
        </span>
      ) : null}
    </span>
  );
}

/** The parade-state panel. */
export function ParadePanel() {
  const { items: messages, error: listError, reload } = useStoredList(listMessages);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OutcomeNote | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const run = (action: () => Promise<void>) => runBusy(setBusy, setResult, action);

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
      void refresh();
    });

  const startEdit = (id: number) =>
    run(async () => {
      const message = await getMessage(id);
      setEditing(id);
      setText(message.body);
      const reasons = reasonsOf(message.error);
      setResult(reasons.length ? { tone: 'error', text: 'Correct these lines and save:', reasons } : null);
      setConfirming(null);
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

  const confirmDelete = (id: number) =>
    run(async () => {
      await deleteMessage(id);
      setConfirming(null);
      if (editing === id) resetForm();
      setResult({ tone: 'good', text: `Deleted #${id} and everything parsed from it.`, reasons: [] });
      await reload();
      void refresh();
    });

  const rows = toMessageRows(messages ?? []).map((row) => ({
    ...row,
    idLabel: '#' + row.id,
    receivedLabel: row.received ? fmtDate(row.received.date) + ', ' + row.received.time : '—',
    statusCell: <StatusCell status={row.status} problems={row.problems} />,
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
